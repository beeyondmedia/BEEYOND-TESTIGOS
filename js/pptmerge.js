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

// Relaciona cada ubicación del plan con su diapositiva: por número de Nombre Crudos y,
// si no hay número, por el texto de la ubicación.
export function matchSites(analysis, sites) {
  const bySite = new Map();
  const used = new Set();
  for (const site of sites) {
    const num = parseCrudos(site.title).number;
    const loc = norm(slideTexts(site).location);
    let slide = num ? analysis.slides.find(s => !used.has(s) && s.number === num) : null;
    if (!slide) slide = analysis.slides.find(s => !used.has(s) && s.loc && norm(s.loc) === loc);
    if (slide) used.add(slide);
    bySite.set(site.title, slide || null);
  }
  return bySite;
}

// Estado de una ubicación respecto a la PPT cargada.
// falta · pendiente (sin fotos y sin fotos nuevas) · completar (sin fotos, hay nuevas)
// parcial (tiene menos fotos que "Fotos por diapositiva") · ok
export function pptStatus(site, slide, perSlide = 0) {
  if (!slide) return 'falta';
  if (slide.pending) return site.photos.length ? 'completar' : 'pendiente';
  if (perSlide && slide.photos < Math.min(4, perSlide)) return 'parcial';
  return 'ok';
}

// Fotos que se pueden agregar a una diapositiva incompleta.
export const faltantes = (slide, perSlide) => Math.max(0, Math.min(4, perSlide) - (slide?.photos || 0));

// opts: { perSlide, selected: Map título -> códigos }. Las incompletas solo se tocan si elegiste
// fotos para ellas (la app no sabe cuáles de las fotos nuevas ya están en tu PPT).
export function planUpdate(analysis, sites, opts = {}) {
  const match = matchSites(analysis, sites);
  const actions = [], incompletas = [];
  for (const site of sites) {
    const slide = match.get(site.title);
    const st = pptStatus(site, slide, opts.perSlide);
    if (st === 'falta') actions.push({ type: 'add', site });
    if (st === 'completar') actions.push({ type: 'replace', site, slide });
    if (st === 'parcial') {
      const valid = new Set(site.photos.map(p => p.code));
      const codes = (opts.selected?.get(site.title) || []).filter(c => valid.has(c)).slice(0, faltantes(slide, opts.perSlide));
      if (codes.length) actions.push({ type: 'fill', site, slide, codes }); else incompletas.push(site);
    }
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

  // Incompletas: se rearma la misma diapositiva con sus fotos actuales + las elegidas.
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };
  const toRender = [];
  for (const a of actions) {
    if (a.type !== 'fill') { toRender.push(a.site); continue; }
    const existing = [];
    for (const p of a.slide.photoPics) {
      const e = analysis.byName.get(p.media);
      if (e) existing.push(await readEntry(analysis.zip, e, MIME[p.media.split('.').pop().toLowerCase()] || ''));
    }
    toRender.push({ ...a.site, _existing: existing, _fillCodes: a.codes });
  }
  const gen = await renderPpt({ ...opts, sites: toRender });
  const g = await openZip(new Blob([gen.buffer]));
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
  const added = [];

  for (let k = 0; k < actions.length; k++) {
    const a = actions[k];
    const gPath = `ppt/slides/slide${k + 1}.xml`;
    let xml = await gText(gPath);
    const gRels = rels(await gText(`ppt/slides/_rels/slide${k + 1}.xml.rels`));
    const out = [];
    for (const r of gRels) {
      if (r.type.endsWith('/notesSlide')) continue;
      if (r.type.endsWith('/slideLayout')) { out.push(`<Relationship Id="${r.id}" Type="${r.type}" Target="${layout}"/>`); continue; }
      if (r.type.endsWith('/image')) {
        const src = resolve(gPath, r.target);
        const ext = src.split('.').pop().toLowerCase();
        const name = `bt-${stamp}-${k + 1}-${r.id}.${ext}`;
        const bytes = new Uint8Array(await (await readEntry(g, gBy.get(src))).arrayBuffer());
        extra.push(newEntry('ppt/media/' + name, bytes));
        out.push(`<Relationship Id="${r.id}" Type="${r.type}" Target="../media/${name}"/>`);
      }
    }
    if (a.type === 'replace' || a.type === 'fill') {
      const s = a.slide;
      // Conserva las notas de la diapositiva original.
      for (const r of s.rels) if (r.type.endsWith('/notesSlide')) out.push(`<Relationship Id="rIdBtNotes" Type="${r.type}" Target="${r.target}"/>`);
      for (const m of s.media) { mediaUse.set(m, mediaUse.get(m) - 1); if (mediaUse.get(m) === 0) replaced.add(m); }
      replaced.add(s.path); replaced.add(s.relsPath);
      const name = (s.path.match(/slide(\d+)\.xml$/) || [])[1];
      xml = xml.replace(/<p:cSld name="[^"]*"/, `<p:cSld name="Slide ${name}"`);
      extra.push(newEntry(s.path, xml));
      extra.push(newEntry(s.relsPath, relsDoc(out)));
    } else {
      const n = nextSlide++;
      const path = `ppt/slides/slide${n}.xml`;
      extra.push(newEntry(path, xml.replace(/<p:cSld name="[^"]*"/, `<p:cSld name="Slide ${n}"`)));
      extra.push(newEntry(`ppt/slides/_rels/slide${n}.xml.rels`, relsDoc(out)));
      ct = ct.replace('</Types>', `<Override PartName="/${path}" ContentType="${SLIDE_CT}"/></Types>`);
      const rid = 'rId' + nextRid++;
      presRelsXml = presRelsXml.replace('</Relationships>', `<Relationship Id="${rid}" Type="${SLIDE_TYPE}" Target="slides/slide${n}.xml"/></Relationships>`);
      added.push({ site: a.site, sldId: `<p:sldId id="${nextSldId++}" r:id="${rid}"/>` });
    }
    opts.onProgress?.(`Integrando diapositivas… ${k + 1} de ${actions.length}`);
  }

  // Inserta las nuevas en el orden del plan: después de la ubicación anterior que ya esté en la PPT.
  const newBySite = new Map(added.map(x => [x.site.title, x.sldId]));
  const firstMatched = order.findIndex(id => base.slides.some(s => s.sldId === id && [...match.values()].includes(s)));
  let anchor = firstMatched < 0 ? order.length - 1 : firstMatched - 1;
  for (const site of opts.sites) {
    const slide = match.get(site.title);
    if (slide) { anchor = order.indexOf(slide.sldId); continue; }
    const id = newBySite.get(site.title);
    if (id) { order.splice(anchor + 1, 0, id); anchor += 1; }
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
  return { added: added.length, replaced: actions.filter(a => a.type === 'replace').length, filled: actions.filter(a => a.type === 'fill').length, total: order.length };
}

function relsDoc(list) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + list.join('') + '</Relationships>';
}
