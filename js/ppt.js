// Genera el PPT de testigos en el navegador con PptxGenJS (copia local en js/vendor),
// con el diseño de las presentaciones de Beeyond (ej. "MP BUEN FIN PREVIA"):
// panel coral a la izquierda con título, ubicación, tipo de medio y ciudad; 4 fotos en cuadrícula.
// Una diapositiva por ubicación del plan, en el orden del plan.
import { readEntry, openZip, buildZip, newEntry } from './zip.js';
import { siteStatus, safeName } from './core.js';

const E = v => v / 914400;          // EMU -> pulgadas (medidas tomadas de la plantilla)
const FONT = 'Rubik';
const PHOTO_W = E(2715814), PHOTO_H = E(2036860);
const GRID = [   // 4 fotos: cuadrícula 2 × 2 de la plantilla
  { x: E(3492917), y: E(320937) }, { x: E(6281882), y: E(320937) },
  { x: E(3492917), y: E(2783874) }, { x: E(6281882), y: E(2783874) },
];
const CENTER_X = (GRID[0].x + GRID[1].x + PHOTO_W) / 2;   // centro horizontal del área de fotos

// Acomodo de fotos según cuántas lleva la diapositiva (pulgadas; todas 4:3 y centradas):
// 1 = una grande · 2 = una arriba de otra · 3 = dos arriba y una centrada abajo · 4 = cuadrícula.
export function photoLayout(n) {
  if (n >= 4) return GRID.map(g => ({ ...g, w: PHOTO_W, h: PHOTO_H }));
  if (n === 3) return [...GRID.slice(0, 2), { x: CENTER_X - PHOTO_W / 2, y: GRID[2].y }].map(g => ({ ...g, w: PHOTO_W, h: PHOTO_H }));
  if (n === 2) {
    const h = 2.42, w = h * 4 / 3, gap = 0.13, y = (5.625 - (2 * h + gap)) / 2;
    return [{ x: CENTER_X - w / 2, y, w, h }, { x: CENTER_X - w / 2, y: y + h + gap, w, h }];
  }
  if (n === 1) { const w = 5.7, h = 4.275; return [{ x: CENTER_X - w / 2, y: (5.625 - h) / 2, w, h }]; }
  return [];
}


let loading;
function loadLib() {
  if (window.PptxGenJS) return Promise.resolve();
  return loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('./vendor/pptxgen.bundle.js', import.meta.url).href;
    s.onload = resolve;
    s.onerror = () => { loading = null; reject(new Error('No se pudo cargar el generador de PPT. Recarga la página e inténtalo de nuevo.')); };
    document.head.append(s);
  });
}

async function asset(name) {
  const blob = await (await fetch(new URL('../assets/ppt/' + name, import.meta.url))).blob();
  return new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
}

// Recorta al centro a 4:3 (como las fotos de la plantilla) y reduce para que el PPT no pese de más.
// Las originales van intactas en el ZIP.
async function photo4x3(blob, width = 1400) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const target = 4 / 3;
  let sw = bmp.width, sh = bmp.height;
  if (sw / sh > target) sw = Math.round(sh * target); else sh = Math.round(sw / target);
  const sx = Math.round((bmp.width - sw) / 2), sy = Math.round((bmp.height - sh) / 2);
  const w = Math.min(width, sw), h = Math.round(w * 3 / 4);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  bmp.close?.();
  return canvas.toDataURL('image/jpeg', 0.82);
}

// "29. CDMX_LANDMARK_Tamarindos" -> { number: '29', city: 'CDMX', format: 'LANDMARK' }
export function parseCrudos(title) {
  const m = String(title).match(/^\s*(\d+)\s*\.\s*(.*)$/);
  const rest = m ? m[2] : String(title);
  const parts = rest.split('_');
  return { number: m ? m[1] : '', city: parts.length > 1 ? parts[0].trim() : '', format: parts.length > 2 ? parts[1].trim() : '' };
}

export function slideTexts(site) {
  const p = parseCrudos(site.title);
  const place = String(site.location || site.title).trim().toUpperCase();
  return {
    location: (p.number ? p.number + '. ' : '') + place,
    format: String(site.format || p.format || '').trim().toUpperCase(),
    city: String(site.city || p.city || '').trim().toUpperCase(),
  };
}

// Fotos y recuadro de estatus de una diapositiva. Con recuadro caben como máximo 3 fotos.
export function slideContent(site, selected, perSlide) {
  const status = siteStatus(site);
  const max = Math.min(4, perSlide) - (status && site.photos.length ? 1 : 0);
  const chosen = (selected || []).filter(c => site.photos.some(p => p.code === c));
  // Si no se eligieron fotos, se usan las primeras vinculadas.
  const codes = (chosen.length ? chosen : site.photos.map(p => p.code)).slice(0, Math.max(1, max));
  return { photos: codes.map(c => site.photos.find(p => p.code === c)), status };
}

export const STATUS_COLORS = { 'Con observaciones': 'E63E5A', 'En revisión': 'B06D00', 'Pendiente': '7A7A7A' };

// Recuadro que lee la app de Comprobación: se llama "BT-ESTATUS"; 1er párrafo = estatus, 2º = comentario.
function addStatusCard(slide, b, { estatus, comentario }) {
  const color = STATUS_COLORS[estatus] || '7A7A7A';
  slide.addText([
    { text: estatus.toUpperCase(), options: { bold: true, fontSize: b.w > 4 ? 22 : 15, color, breakLine: true } },
    { text: comentario, options: { fontSize: b.w > 4 ? 16 : 11, color: '33414E' } },
  ], {
    shape: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, objectName: 'BT-ESTATUS',
    fill: { color: 'FFFFFF' }, line: { color, width: 2, ...(estatus === 'Pendiente' ? { dashType: 'dash' } : {}) },
    align: 'center', valign: 'middle', fontFace: FONT, margin: 12, paraSpaceAfter: 6, fit: 'shrink',
  });
}

/**
 * opts: { title, fileName, sites, selected: Map title->codes, perSlide, zip, entryByName, onProgress }
 */
const ASSETS = ['panel.png', 'header.png', 'header-icon.png', 'corner.png', 'pin.png', 'logo.png'];
const loadAssets = async () => Object.fromEntries((await Promise.all(ASSETS.map(asset))).map((d, i) => [ASSETS[i], d]));
function newDeck(title) {
  const pptx = new window.PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';      // 10 x 5.625 in, igual que la plantilla
  pptx.title = title;
  pptx.company = 'Beeyond Media';
  return pptx;
}

// Marco de la diapositiva: panel coral con título, ubicación, tipo de medio, ciudad y logo.
function drawFrame(slide, site, title, A) {
  const white = { color: 'FFFFFF', fontFace: FONT, margin: 0, valign: 'top', align: 'left', isTextBox: true };
  const t = slideTexts(site);
  slide.background = { color: 'F6F6F6' };
  slide.addImage({ data: A['panel.png'], x: 0, y: E(7315), w: E(3334500), h: E(5151730) });
  slide.addImage({ data: A['header.png'], x: 0, y: E(300838), w: E(2999964), h: E(1176010) });
  slide.addImage({ data: A['header-icon.png'], x: E(310896), y: E(533644), w: E(246065), h: E(246065) });
  slide.addText(title, { ...white, x: E(433791), y: E(592440), w: E(2565989), h: E(677113), fontSize: 16 });
  slide.addImage({ data: A['corner.png'], x: E(2608143), y: E(1112002), w: E(441564), h: E(441564), rotate: 90 });
  slide.addImage({ data: A['pin.png'], x: E(248351), y: E(2212848), w: E(246065), h: E(246065) });
  slide.addText([
    { text: t.location, options: { breakLine: true } },
    { text: '', options: { breakLine: true } },
    { text: ' ' + t.format + ' ' },
  ], { ...white, x: E(566928), y: E(2212848), w: E(2788920), h: E(992490), fontSize: 12 });
  slide.addText(t.city, { ...white, x: E(145390), y: E(4550969), w: E(2854482), h: E(253746), fontSize: 12 });
  slide.addImage({ data: A['logo.png'], x: E(8712403), y: E(4673498), w: E(557601), h: E(124358), rotate: 270 });
}

export async function renderPpt(opts) {
  await loadLib();
  const A = await loadAssets();
  const pptx = newDeck(opts.title);
  let done = 0, withPhotos = 0;
  for (const site of opts.sites) {
    const { photos, status } = slideContent(site, opts.selected.get(site.title), opts.perSlide);
    if (photos.length) withPhotos++;
    const slide = pptx.addSlide();
    drawFrame(slide, site, opts.title, A);

    // El recuadro de estatus ocupa el lugar de una foto (va al final).
    const boxes = photoLayout(photos.length + (status ? 1 : 0));
    for (let i = 0; i < photos.length; i++) {
      const data = await photo4x3(await readEntry(opts.zip, opts.entryByName.get(photos[i].member)));
      const b = boxes[i];
      slide.addImage({ data, x: b.x, y: b.y, w: b.w, h: b.h });
    }
    if (status) addStatusCard(slide, boxes[photos.length], status);
    opts.onProgress?.(++done, opts.sites.length);
  }
  const buffer = await pptx.write({ outputType: 'arraybuffer' });
  return { buffer, slides: opts.sites.length, withPhotos, pending: opts.sites.length - withPhotos };
}

export const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export function download(blob, fileName) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = fileName;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// PPT nuevo con todas las ubicaciones.
export async function buildPpt(opts) {
  const out = await renderPpt(opts);
  // PptxGenJS agrega entradas de carpeta al ZIP; algunas nubes (OneDrive, Drive) fallan al abrirlas.
  // Se reempaqueta sin ellas, copiando el contenido tal cual.
  const zip = await openZip(new Blob([out.buffer]));
  const clean = await buildZip(zip.entries.filter(e => !e.dir).map(entry => ({ name: entry.name, zip, entry })));
  download(new Blob([clean], { type: PPTX_TYPE }), opts.fileName);
  return out;
}

// ---------------------------------------------------------------- PPT en blanco (solo con el plan)
// Una diapositiva por ubicación con el marco de Beeyond y N marcadores de imagen de PowerPoint
// (ícono para insertar la foto con un clic; se ajusta sola al espacio). Cada marcador se llama
// como el archivo esperado (Nombre Crudos_01, _02…) en el panel de selección.
export async function buildBlankPpt({ title, sites, slots, fileName, onProgress }) {
  await loadLib();
  const A = await loadAssets();
  const pptx = newDeck(title);
  const boxes = photoLayout(slots);
  pptx.defineSlideMaster({
    title: 'BT_FOTOS', background: { color: 'F6F6F6' },
    objects: boxes.map((b, i) => ({ placeholder: { options: { name: 'foto' + (i + 1), type: 'body', x: b.x, y: b.y, w: b.w, h: b.h }, text: 'Foto ' + (i + 1) } })),
  });
  sites.forEach((site, i) => { drawFrame(pptx.addSlide({ masterName: 'BT_FOTOS' }), site, title, A); onProgress?.(i + 1, sites.length); });
  const g = await openZip(new Blob([await pptx.write({ outputType: 'arraybuffer' })]));
  const text = async e => (await readEntry(g, e)).text();
  const items = [];
  let layoutPath = '', idxs = [];
  for (const e of g.entries) {
    if (!/^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(e.name)) continue;
    const xml = await text(e);
    if (!xml.includes('<p:cSld name="BT_FOTOS">')) continue;
    layoutPath = e.name;
    idxs = [...xml.matchAll(/<p:ph\s+idx="(\d+)"/g)].map(m => m[1]);
  }
  if (!layoutPath || idxs.length !== slots) throw new Error('No se pudo armar el diseño de la PPT en blanco.');
  const layoutName = layoutPath.split('/').pop();
  for (const e of g.entries) {
    if (e.dir) continue;
    if (e.name === layoutPath) {
      // Marcadores de imagen: tipo "pic", fondo gris claro y texto centrado.
      let xml = await text(e);
      xml = xml.replace(/<p:ph\s+idx="(\d+)"\s+hasCustomPrompt="1"\s*\/>/g, '<p:ph type="pic" idx="$1" hasCustomPrompt="1"/>')
        .replace(/<a:noFill\/><a:ln><\/a:ln><\/p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0">/g,
          '<a:solidFill><a:srgbClr val="E6E6E6"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="ctr">')
        .replace(/<a:lvl1pPr indent="0" marL="0">/g, '<a:lvl1pPr indent="0" marL="0" algn="ctr">');
      items.push(newEntry(e.name, xml));
      continue;
    }
    const m = e.name.match(/^ppt\/slides\/slide(\d+)\.xml$/);
    if (m) {
      const relsE = g.entries.find(x => x.name === `ppt/slides/_rels/slide${m[1]}.xml.rels`);
      if (relsE && (await text(relsE)).includes(layoutName)) {
        const site = sites[+m[1] - 1];
        const base = safeName(site.title);
        const ph = idxs.map((idx, k) => `<p:sp><p:nvSpPr><p:cNvPr id="${900 + k}" name="${xmlEsc(base + '_' + String(k + 1).padStart(2, '0'))}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="pic" idx="${idx}"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>`).join('');
        // Quita los cuadros de texto que PptxGenJS copia del diseño y pone los marcadores de imagen.
        const xml = (await text(e)).replace(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<p:ph\b[\s\S]*?<\/p:sp>/g, '');
        items.push(newEntry(e.name, xml.replace('</p:spTree>', ph + '</p:spTree>')));
        continue;
      }
    }
    items.push({ name: e.name, zip: g, entry: e });
  }
  items.sort((x, y) => (y.name === '[Content_Types].xml') - (x.name === '[Content_Types].xml'));
  download(new Blob([await buildZip(items)], { type: PPTX_TYPE }), fileName);
  return { slides: sites.length };
}
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
