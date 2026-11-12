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

// Fotos y recuadro de estatus de una diapositiva. Solo van las fotos que elegiste:
// sin selección, la diapositiva lleva espacios vacíos para insertarlas a mano.
export function slideContent(site, selected, perSlide) {
  const status = siteStatus(site);
  const chosen = (selected || []).filter(c => site.photos.some(p => p.code === c)).slice(0, Math.min(4, perSlide));
  return { photos: chosen.map(c => site.photos.find(p => p.code === c)), status };
}

export const STATUS_COLORS = { 'Con observaciones': 'E63E5A', 'En revisión': 'B06D00', 'Pendiente': '7A7A7A' };

// Recuadro que lee la app de Comprobación: se llama "BT-ESTATUS"; 1er párrafo = estatus, 2º = comentario.
// Va en el panel coral, debajo de la ubicación, para no ocupar el lugar de una foto.
export const STATUS_BOX = { x: E(248351), y: 3.55, w: 2.92, h: 1.25 };
function addStatusCard(slide, { estatus, comentario }) {
  const color = STATUS_COLORS[estatus] || '7A7A7A', b = STATUS_BOX;
  slide.addText([
    { text: estatus.toUpperCase(), options: { bold: true, fontSize: 11, color, breakLine: true } },
    { text: comentario, options: { fontSize: comentario.length > 140 ? 7 : comentario.length > 80 ? 8 : 9, color: '33414E' } },
  ], {
    shape: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, objectName: 'BT-ESTATUS',
    fill: { color: 'FFFFFF' }, line: { color, width: 1.5 },
    align: 'left', valign: 'middle', fontFace: FONT, margin: 6, paraSpaceAfter: 3, fit: 'shrink',
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

// Diseños con N marcadores de imagen (1 a 4), acomodados como las fotos.
function defineFotoLayouts(pptx) {
  for (let n = 1; n <= 4; n++) {
    pptx.defineSlideMaster({
      title: 'BT_FOTOS_' + n, background: { color: 'F6F6F6' },
      objects: photoLayout(n).map((b, i) => ({ placeholder: { options: { name: `foto${n}_${i + 1}`, type: 'body', x: b.x, y: b.y, w: b.w, h: b.h }, text: 'Foto ' + (i + 1) } })),
    });
  }
}

/**
 * opts: { title, sites, selected: Map título -> códigos, perSlide, zip, entryByName, onProgress, noStatus }
 * Devuelve { buffer, slides, withPhotos, pending } con el PPT ya listo (marcadores de imagen incluidos).
 */
export async function renderPpt(opts) {
  await loadLib();
  const A = await loadAssets();
  const pptx = newDeck(opts.title);
  defineFotoLayouts(pptx);
  const n = Math.min(4, Math.max(1, opts.perSlide || 4));
  const slots = new Map();   // nº de diapositiva -> { n, from, base } para las que llevan espacios vacíos
  let done = 0, withPhotos = 0;
  for (const site of opts.sites) {
    // Diapositiva incompleta de una PPT ya hecha: sus fotos actuales primero y luego las elegidas.
    const existing = site._existing || [];
    const { photos, status } = site._existing
      ? { photos: site._fillCodes.map(c => site.photos.find(p => p.code === c)), status: siteStatus(site) }
      : slideContent(site, opts.selected?.get(site.title), n);
    const items = [...existing.map(blob => ({ blob })), ...photos].slice(0, 4);
    // Siempre el acomodo de "Fotos por diapositiva": las fotos en los primeros espacios y los que
    // falten quedan vacíos (marcadores de imagen) para insertarlas a mano.
    const total = Math.max(n, items.length);
    const slide = items.length >= total ? pptx.addSlide() : pptx.addSlide({ masterName: 'BT_FOTOS_' + total });
    drawFrame(slide, site, opts.title, A);
    if (items.length < total) slots.set(done + 1, { n: total, from: items.length, base: safeName(site.title) });
    if (items.length) {
      withPhotos++;
      const boxes = photoLayout(total);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        let data;
        try { data = await photo4x3(it.blob || await readEntry(opts.zip, opts.entryByName.get(it.member))); }
        catch (e) { if (it.blob) throw new Error(`No pude leer una de las fotos que ya tiene tu PPT en la diapositiva de ${site.title}. Complétala a mano o quita esa selección.`); throw e; }
        const b = boxes[i];
        slide.addImage({ data, x: b.x, y: b.y, w: b.w, h: b.h });
      }
    }
    if (status && !opts.noStatus) addStatusCard(slide, status);
    opts.onProgress?.(++done, opts.sites.length);
  }
  const buffer = await finishDeck(await pptx.write({ outputType: 'arraybuffer' }), slots);
  return { buffer, slides: opts.sites.length, withPhotos, pending: opts.sites.length - withPhotos };
}

// Termina el paquete: marcadores de imagen reales (tipo "pic") en los diseños y en las diapositivas
// sin fotos, y sin las entradas de carpeta que agrega PptxGenJS (algunas nubes fallan al abrirlas).
async function finishDeck(buffer, slots) {
  const g = await openZip(new Blob([buffer]));
  const text = async e => (await readEntry(g, e)).text();
  const layouts = new Map();   // archivo del diseño -> { n, idxs }
  for (const e of g.entries) {
    if (!/^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(e.name)) continue;
    const xml = await text(e), m = xml.match(/<p:cSld name="BT_FOTOS_(\d)">/);
    if (m) layouts.set(e.name, { n: +m[1], xml, idxs: [...xml.matchAll(/<p:ph\s+idx="(\d+)"/g)].map(x => x[1]) });
  }
  const byN = new Map([...layouts.entries()].map(([path, l]) => [l.n, { ...l, file: path.split('/').pop() }]));
  const items = [];
  for (const e of g.entries) {
    if (e.dir) continue;
    if (layouts.has(e.name)) {
      // Tipo "pic", fondo gris claro y texto centrado.
      const xml = layouts.get(e.name).xml.replace(/<p:ph\s+idx="(\d+)"\s+hasCustomPrompt="1"\s*\/>/g, '<p:ph type="pic" idx="$1" hasCustomPrompt="1"/>')
        .replace(/<a:noFill\/><a:ln><\/a:ln><\/p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0">/g,
          '<a:solidFill><a:srgbClr val="E6E6E6"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="ctr">')
        .replace(/<a:lvl1pPr indent="0" marL="0">/g, '<a:lvl1pPr indent="0" marL="0" algn="ctr">');
      items.push(newEntry(e.name, xml));
      continue;
    }
    const m = e.name.match(/^ppt\/slides\/slide(\d+)\.xml$/);
    const slot = m && slots.get(+m[1]);
    if (slot) {
      const l = byN.get(slot.n);
      // Cada marcador lleva su posición (así sirve aunque la diapositiva pase a otra presentación)
      // y se llama como el archivo esperado: Nombre Crudos_01, _02…
      const ph = photoLayout(slot.n).map((b, k) => k < slot.from ? '' : `<p:sp><p:nvSpPr><p:cNvPr id="${900 + k}" name="${xmlEsc(slot.base + '_' + String(k + 1).padStart(2, '0'))}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="pic" idx="${l.idxs[k]}"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(b.x * 914400)}" y="${Math.round(b.y * 914400)}"/><a:ext cx="${Math.round(b.w * 914400)}" cy="${Math.round(b.h * 914400)}"/></a:xfrm></p:spPr></p:sp>`).join('');
      // Quita los cuadros de texto que PptxGenJS copia del diseño y pone los marcadores de imagen.
      const xml = (await text(e)).replace(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<p:ph\b[\s\S]*?<\/p:sp>/g, '');
      items.push(newEntry(e.name, xml.replace('</p:spTree>', ph + '</p:spTree>')));
      continue;
    }
    items.push({ name: e.name, zip: g, entry: e });
  }
  items.sort((x, y) => (y.name === '[Content_Types].xml') - (x.name === '[Content_Types].xml'));
  return new Uint8Array(await (await buildZip(items)).arrayBuffer());
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
  download(new Blob([out.buffer], { type: PPTX_TYPE }), opts.fileName);
  return out;
}

// ---------------------------------------------------------------- PPT en blanco (solo con el plan)
// Una diapositiva por ubicación con el marco de Beeyond y N marcadores de imagen de PowerPoint
// (ícono para insertar la foto con un clic; se ajusta sola al espacio).
export async function buildBlankPpt({ title, sites, slots, fileName, onProgress }) {
  const out = await renderPpt({ title, sites, perSlide: slots, selected: new Map(), noStatus: true, onProgress });
  download(new Blob([out.buffer], { type: PPTX_TYPE }), fileName);
  return { slides: sites.length };
}
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
