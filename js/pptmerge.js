// Actualiza una presentación ya hecha: agrega las ubicaciones que faltan y completa las que
// estaban como "Pendiente". Las demás diapositivas, fotos y medios se copian tal cual
// (no se carga la presentación completa en memoria; solo se leen sus XML).
import { openZip, readEntry, buildZip, newEntry } from './zip.js';
import { norm } from './core.js';
import { parseCrudos, slideTexts, renderPpt, download, PPTX_TYPE } from './ppt.js';

const attr = (s, n) => (s.match(new RegExp(`\\b${n}="([^"]*)"`)) || [])[1];
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const rels = xml => [...xml.matchAll(/<Relationship\b[^>]*>/g)].map(m => ({ raw: m[0], id: attr(m[0], 'Id'), type: attr(m[0], 'Type') || '', target: attr(m[0], 'Target') || '' }));
const SLIDE_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';

function resolve(base, target) {   // base: 'ppt/slides/slide1.xml', target: '../media/x.png'
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/'); parts.pop();
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');
}
function xfrm(block) {
  const off = block.match(/<a:off\b[^>]*>/), ext = block.match(/<a:ext\b[^>]*>/);
  return off && ext ? { x: +attr(off[0], 'x'), y: +attr(off[0], 'y'), cx: +attr(ext[0], 'cx'), cy: +attr(ext[0], 'cy') } : null;
}

export async function analyzePpt(file) {
  let zip;
  try { zip = await openZip(file); } catch { throw new Error(`"${file.name}" no es un archivo .pptx válido.`); }
  const byName = new Map(zip.entries.map(e => [e.name, e]));
  const text = async name => { const e = byName.get(name); return e ? (await readEntry(zip, e)).text() : ''; };
  const pres = await text('ppt/presentation.xml');
  if (!pres) throw new Error(`"${file.name}" no parece una presentación de PowerPoint.`);
  const sz = pres.match(/<p:sldSz\b[^>]*>/);
  const W = sz ? +attr(sz[0], 'cx') : 9144000, H = sz ? +attr(sz[0], 'cy') : 5143500;
  const presRels = rels(await text('ppt/_rels/presentation.xml.rels'));
  const relById = new Map(presRels.map(r => [r.id, r]));
  const slides = [];
  for (const m of pres.matchAll(/<p:sldId\b[^>]*\/>/g)) {
    const rid = attr(m[0], 'r:id'), rel = relById.get(rid);
    if (!rel) continue;
    const path = resolve('ppt/presentation.xml', rel.target);
    const relsPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
    const xml = await text(path);
    const srels = rels(await text(relsPath));
    const relTarget = new Map(srels.map(r => [r.id, r.target]));
    const photoPics = [];   // fotos de la diapositiva, en orden de lectura (para completarla sin perderlas)
    for (const p of xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)) {
      const g = xfrm(p[0]);
      const rid = attr(p[0].match(/<a:blip\b[^>]*>/)?.[0] || '', 'r:embed');
      const media = rid && relTarget.get(rid) ? resolve(path, relTarget.get(rid)) : '';
      // Foto en marcador de imagen sin posición propia (hereda la del diseño): cuenta como foto.
      if (!g) { if (/<p:ph\b/.test(p[0]) && media) photoPics.push({ media, x: 0, y: 1e12 + photoPics.length }); continue; }
      const a = g.cx * g.cy, cx = g.x + g.cx / 2;
      // Fotos = imágenes grandes del lado derecho; panel, íconos y logo no cuentan.
      if (a >= W * H * 0.03 && a <= W * H * 0.6 && cx >= W * 0.4) photoPics.push({ media, x: g.x, y: g.y });
    }
    photoPics.sort((a, b) => (Math.abs(a.y - b.y) > 200000 ? a.y - b.y : a.x - b.x));
    const photos = photoPics.length;
    const texts = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
      .map(p => [...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(x => unxml(x[1])).join('').trim()).filter(Boolean);
    const loc = texts.find(t => /^\d+\s*\./.test(t)) || '';
    slides.push({
      sldId: m[0], rid, path, relsPath, rels: srels,
      layout: srels.find(r => r.type.endsWith('/slideLayout'))?.target,
      media: srels.filter(r => r.type.endsWith('/image')).map(r => resolve(path, r.target)),
      number: (loc.match(/^(\d+)/) || [])[1] || '', loc, photos, photoPics,
      pending: photos === 0, hidden: /<p:sld\b[^>]*\bshow="0"/.test(xml),
    });
  }
  return { file, zip, byName, pres, presRels, W, H, slides, name: file.name };
}

// Relaciona cada ubicación del plan con sus diapositivas (puede tener varias si lleva más de
// "Fotos por diapositiva"): por número de Nombre Crudos y, si no hay número, por el texto de la ubicación.
export function matchSites(analysis, sites) {
  const bySite = new Map();
  const used = new Set();
  for (const site of sites) {
    const num = parseCrudos(site.title).number;
    const loc = norm(slideTexts(site).location);
    let list = num ? analysis.slides.filter(s => !used.has(s) && s.number === num) : [];
    if (!list.length) list = analysis.slides.filter(s => !used.has(s) && s.loc && norm(s.loc) === loc);
    list.forEach(s => used.add(s));
    bySite.set(site.title, list);
  }
  return bySite;
}

// Estado de una ubicación respecto a la PPT cargada (slides = sus diapositivas).
// falta · pendiente (sin fotos y sin fotos nuevas) · completar (sin fotos, hay nuevas)
// parcial (su última diapositiva tiene espacio) · ok (llenas)
export function pptStatus(site, slides, perSlide = 0) {
  if (!slides || !slides.length) return 'falta';
  if (slides.every(s => s.pending)) return site.photos.length ? 'completar' : 'pendiente';
  if (perSlide && slides[slides.length - 1].photos < Math.min(6, perSlide)) return 'parcial';
  return 'ok';
}
export const totalFotos = slides => (slides || []).reduce((a, s) => a + s.photos, 0);

// Espacio libre en la última diapositiva de la ubicación.
export const faltantes = (slides, perSlide) => {
  const last = slides && slides.length ? slides[slides.length - 1] : null;
  return Math.max(0, Math.min(6, perSlide) - (last?.photos || 0));
};

// opts: { perSlide, selected: Map título -> códigos }. Las ubicaciones que ya están en tu PPT solo se tocan
// si elegiste fotos para ellas (la app no sabe cuáles de las fotos nuevas ya están en tu PPT):
// - sin fotos en la PPT: se rearma su diapositiva con las elegidas (y sigue en otras si son más);
// - con espacio en la última diapositiva: se rearma con sus fotos + las elegidas, y lo que no quepa sigue después;
// - llenas: las elegidas van en diapositivas nuevas justo después.
// Las ubicaciones que faltan se agregan siempre (con las fotos elegidas o con espacios vacíos).
export function planUpdate(analysis, sites, opts = {}) {
  const match = matchSites(analysis, sites);
  const actions = [], incompletas = [];
  for (const site of sites) {
    const slides = match.get(site.title);
    const st = pptStatus(site, slides, opts.perSlide);
    if (st === 'falta') { actions.push({ type: 'add', site }); continue; }
    const valid = new Set(site.photos.map(p => p.code));
    const codes = (opts.selected?.get(site.title) || []).filter(c => valid.has(c));
    const last = slides[slides.length - 1];
    if (st === 'completar') { if (codes.length) actions.push({ type: 'replace', site, slide: slides[0], codes, first: true }); else incompletas.push(site); }
    if (st === 'parcial') { if (codes.length) actions.push({ type: 'fill', site, slide: last, codes, first: slides.length === 1 }); else incompletas.push(site); }
    if (st === 'ok' && codes.length) actions.push({ type: 'append', site, slide: last, codes });
  }
  return { match, actions, incompletas };
}
/**
 * opts: lo mismo que renderPpt + { analysis, fileName, onProgress }
 * Devuelve { added, replaced }.
 */
export async function updatePpt(opts) {
  const { analysis } = opts;
  if (analysis.W !== 9144000 || analysis.H !== 5143500) {
    throw new Error('La presentación cargada no tiene el tamaño 16:9 de la plantilla (10 × 5.63 pulgadas); no se puede actualizar.');
  }
  const { match, actions } = planUpdate(analysis, opts.sites, { perSlide: opts.perSlide, selected: opts.selected });
  if (!actions.length) throw new Error('La presentación ya tiene todas las ubicaciones; no hay diapositivas por agregar ni pendientes con fotos nuevas.');

  // Incompletas: se rearma la misma diapositiva con sus fotos actuales (mismos bytes) + las elegidas.
  const toRender = actions.map(a => {
    if (a.type === 'add') return a.site;
    const existing = a.type === 'fill' ? a.slide.photoPics.map(p => analysis.byName.get(p.media)).filter(Boolean).map(entry => ({ zip: analysis.zip, entry })) : [];
    // Numeración de los espacios vacíos: continúa después de las fotos que ya tiene la ubicación.
    const all = totalFotos(match.get(a.site.title));
    const _offset = a.type === 'append' ? all : a.type === 'fill' ? all - a.slide.photos : 0;
    return { ...a.site, _existing: existing, _fillCodes: a.codes, _noStatus: !a.first, _offset };
  });
  const gen = await renderPpt({ ...opts, sites: toRender });
  const g = await openZip(gen.blob);
  const gBy = new Map(g.entries.map(e => [e.name, e]));
  const gText = async n => (await readEntry(g, gBy.get(n))).text();

  const base = analysis;
  const replaced = new Set(['ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels', '[Content_Types].xml', 'docProps/app.xml']);
  const extra = [];
  const layout = base.slides.find(s => s.layout)?.layout || '../slideLayouts/slideLayout1.xml';
  const stamp = Date.now().toString(36);
  let nextSlide = Math.max(0, ...[...base.byName.keys()].map(n => +((n.match(/^ppt\/slides\/slide(\d+)\.xml$/) || [])[1] || 0))) + 1;
  let nextSldId = Math.max(255, ...[...base.pres.matchAll(/<p:sldId\b[^>]*\bid="(\d+)"/g)].map(m => +m[1])) + 1;
  let nextRid = Math.max(0, ...base.presRels.map(r => +(r.id.match(/^rId(\d+)$/) || [])[1] || 0)) + 1;

  // Medios usados por cada diapositiva de la base, para quitar los que queden huérfanos al completar pendientes.
  const mediaUse = new Map();
  for (const s of base.slides) for (const m of s.media) mediaUse.set(m, (mediaUse.get(m) || 0) + 1);

  let ct = await (await readEntry(base.zip, base.byName.get('[Content_Types].xml'))).text();
  for (const [ext, type] of [['jpeg', 'image/jpeg'], ['png', 'image/png']]) {
    if (!new RegExp(`<Default\\b[^>]*Extension="${ext}"`, 'i').test(ct)) ct = ct.replace('</Types>', `<Default Extension="${ext}" ContentType="${type}"/></Types>`);
  }
  let presRelsXml = await (await readEntry(base.zip, base.byName.get('ppt/_rels/presentation.xml.rels'))).text();
  const order = base.slides.map(s => s.sldId);        // lista de <p:sldId/> en el orden actual

  // Copia una diapositiva generada al paquete. Si target viene, la reemplaza; si no, crea una nueva.
  let gi = 0;
  const copySlide = async (num, target) => {
    const gPath = `ppt/slides/slide${num}.xml`;
    let xml = await gText(gPath);
    const gRels = rels(await gText(`ppt/slides/_rels/slide${num}.xml.rels`));
    const out = [];
    for (const r of gRels) {
      if (r.type.endsWith('/notesSlide')) continue;
      if (r.type.endsWith('/slideLayout')) { out.push(`<Relationship Id="${r.id}" Type="${r.type}" Target="${layout}"/>`); continue; }
      if (r.type.endsWith('/image')) {
        const src = resolve(gPath, r.target);
        const ext = src.split('.').pop().toLowerCase();
        const name = `bt-${stamp}-${++gi}.${ext}`;
        extra.push({ name: 'ppt/media/' + name, zip: g, entry: gBy.get(src) });   // fotos tal cual, sin recomprimir
        out.push(`<Relationship Id="${r.id}" Type="${r.type}" Target="../media/${name}"/>`);
      }
    }
    if (target) {
      // Conserva las notas de la diapositiva original.
      for (const r of target.rels) if (r.type.endsWith('/notesSlide')) out.push(`<Relationship Id="rIdBtNotes" Type="${r.type}" Target="${r.target}"/>`);
      for (const m of target.media) { mediaUse.set(m, mediaUse.get(m) - 1); if (mediaUse.get(m) === 0) replaced.add(m); }
      replaced.add(target.path); replaced.add(target.relsPath);
      const name = (target.path.match(/slide(\d+)\.xml$/) || [])[1];
      extra.push(newEntry(target.path, xml.replace(/<p:cSld name="[^"]*"/, `<p:cSld name="Slide ${name}"`)));
      extra.push(newEntry(target.relsPath, relsDoc(out)));
      return target.sldId;
    }
    const n = nextSlide++;
    const path = `ppt/slides/slide${n}.xml`;
    extra.push(newEntry(path, xml.replace(/<p:cSld name="[^"]*"/, `<p:cSld name="Slide ${n}"`)));
    extra.push(newEntry(`ppt/slides/_rels/slide${n}.xml.rels`, relsDoc(out)));
    ct = ct.replace('</Types>', `<Override PartName="/${path}" ContentType="${SLIDE_CT}"/></Types>`);
    const rid = 'rId' + nextRid++;
    presRelsXml = presRelsXml.replace('</Relationships>', `<Relationship Id="${rid}" Type="${SLIDE_TYPE}" Target="slides/slide${n}.xml"/></Relationships>`);
    return `<p:sldId id="${nextSldId++}" r:id="${rid}"/>`;
  };

  const newBySite = new Map();   // ubicaciones que faltaban -> sus diapositivas nuevas
  let addedSlides = 0;
  for (let k = 0; k < actions.length; k++) {
    const a = actions[k], nums = gen.bySite[k];
    if (a.type === 'add') {
      const ids = [];
      for (const num of nums) ids.push(await copySlide(num));
      newBySite.set(a.site.title, ids); addedSlides += ids.length;
    } else {
      // replace / fill: la primera generada sustituye a la diapositiva; append: todas van después de ella.
      let after = a.slide.sldId, rest = nums;
      if (a.type !== 'append') { await copySlide(nums[0], a.slide); rest = nums.slice(1); }
      for (const num of rest) {
        const id = await copySlide(num);
        order.splice(order.indexOf(after) + 1, 0, id); after = id; addedSlides++;
      }
    }
    opts.onProgress?.(`Integrando diapositivas… ${k + 1} de ${actions.length}`);
  }

  // Inserta las ubicaciones que faltaban en el orden del plan: después de la ubicación anterior que ya esté.
  const firstMatched = order.findIndex(id => base.slides.some(s => s.sldId === id && [...match.values()].some(l => l.includes(s))));
  let anchor = firstMatched < 0 ? order.length - 1 : firstMatched - 1;
  for (const site of opts.sites) {
    const slides = match.get(site.title);
    if (slides && slides.length) { anchor = Math.max(...slides.map(s => order.indexOf(s.sldId))); continue; }
    const ids = newBySite.get(site.title);
    if (ids) { order.splice(anchor + 1, 0, ...ids); anchor += ids.length; }
  }
  const pres = base.pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\/>/, `<p:sldIdLst>${order.join('')}</p:sldIdLst>`);

  let app = base.byName.get('docProps/app.xml') ? await (await readEntry(base.zip, base.byName.get('docProps/app.xml'))).text() : '';
  if (app) app = app.replace(/<Slides>\d+<\/Slides>/, `<Slides>${order.length}</Slides>`);

  const items = base.zip.entries.filter(e => !e.dir && !replaced.has(e.name)).map(entry => ({ name: entry.name, zip: base.zip, entry }));
  items.push(newEntry('ppt/presentation.xml', pres), newEntry('ppt/_rels/presentation.xml.rels', presRelsXml), newEntry('[Content_Types].xml', ct));
  if (app) items.push(newEntry('docProps/app.xml', app));
  // [Content_Types].xml primero, como en los paquetes de Office.
  items.sort((x, y) => (y.name === '[Content_Types].xml') - (x.name === '[Content_Types].xml'));
  const blob = await buildZip([...items, ...extra]);
  download(new Blob([blob], { type: PPTX_TYPE }), opts.fileName);
  return { added: newBySite.size, addedSlides, replaced: actions.filter(a => a.type === 'replace').length, filled: actions.filter(a => a.type === 'fill').length, appended: actions.filter(a => a.type === 'append').length, total: order.length };
}

function relsDoc(list) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + list.join('') + '</Relationships>';
}
