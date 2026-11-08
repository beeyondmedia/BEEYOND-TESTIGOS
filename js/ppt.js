// Genera el PPT de testigos en el navegador con PptxGenJS (copia local en js/vendor),
// con el diseño de las presentaciones de Beeyond (ej. "MP BUEN FIN PREVIA"):
// panel coral a la izquierda con título, ubicación, tipo de medio y ciudad; 4 fotos en cuadrícula.
// Una diapositiva por ubicación del plan, en el orden del plan.
import { readEntry, openZip, buildZip } from './zip.js';

const E = v => v / 914400;          // EMU -> pulgadas (medidas tomadas de la plantilla)
const FONT = 'Rubik';
const PHOTO_W = E(2715814), PHOTO_H = E(2036860);
const PHOTO_SLOTS = [
  { x: E(3492917), y: E(320937) }, { x: E(6281882), y: E(320937) },
  { x: E(3492917), y: E(2783874) }, { x: E(6281882), y: E(2783874) },
];

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

/**
 * opts: { title, fileName, sites, selected: Map title->codes, perSlide, zip, entryByName, onProgress }
 */
export async function renderPpt(opts) {
  await loadLib();
  const [panel, header, headerIcon, corner, pin, logo] = await Promise.all(
    ['panel.png', 'header.png', 'header-icon.png', 'corner.png', 'pin.png', 'logo.png'].map(asset));
  const pptx = new window.PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';      // 10 x 5.625 in, igual que la plantilla
  pptx.title = opts.title;
  pptx.company = 'Beeyond Media';
  const white = { color: 'FFFFFF', fontFace: FONT, margin: 0, valign: 'top', align: 'left', isTextBox: true };

  let done = 0, withPhotos = 0;
  for (const site of opts.sites) {
    const chosen = (opts.selected.get(site.title) || []).filter(c => site.photos.some(p => p.code === c));
    // Si no se eligieron fotos, se usan las primeras vinculadas.
    const codes = (chosen.length ? chosen : site.photos.slice(0, opts.perSlide).map(p => p.code)).slice(0, 4);
    const photos = codes.map(c => site.photos.find(p => p.code === c));
    if (photos.length) withPhotos++;
    const t = slideTexts(site);

    const slide = pptx.addSlide();
    slide.background = { color: 'F6F6F6' };
    slide.addImage({ data: panel, x: 0, y: E(7315), w: E(3334500), h: E(5151730) });
    slide.addImage({ data: header, x: 0, y: E(300838), w: E(2999964), h: E(1176010) });
    slide.addImage({ data: headerIcon, x: E(310896), y: E(533644), w: E(246065), h: E(246065) });
    slide.addText(opts.title, { ...white, x: E(433791), y: E(592440), w: E(2565989), h: E(677113), fontSize: 16 });
    slide.addImage({ data: corner, x: E(2608143), y: E(1112002), w: E(441564), h: E(441564), rotate: 90 });
    slide.addImage({ data: pin, x: E(248351), y: E(2212848), w: E(246065), h: E(246065) });
    slide.addText([
      { text: t.location, options: { breakLine: true } },
      { text: '', options: { breakLine: true } },
      { text: ' ' + t.format + ' ' },
    ], { ...white, x: E(566928), y: E(2212848), w: E(2788920), h: E(992490), fontSize: 12 });
    slide.addText(t.city, { ...white, x: E(145390), y: E(4550969), w: E(2854482), h: E(253746), fontSize: 12 });
    slide.addImage({ data: logo, x: E(8712403), y: E(4673498), w: E(557601), h: E(124358), rotate: 270 });

    if (!photos.length) {
      const x = PHOTO_SLOTS[0].x, y = PHOTO_SLOTS[0].y;
      const w = PHOTO_SLOTS[1].x + PHOTO_W - x - 0.2, h = PHOTO_SLOTS[2].y + PHOTO_H - y;  // deja libre el logo
      slide.addShape('rect', { x, y, w, h, fill: { color: 'ECECEC' }, line: { color: 'C8C8C8', dashType: 'dash', width: 1 } });
      slide.addText('Pendiente', { x, y, w, h, align: 'center', valign: 'middle', fontSize: 20, color: '7A7A7A', fontFace: FONT, isTextBox: true });
    }
    for (let i = 0; i < photos.length; i++) {
      const data = await photo4x3(await readEntry(opts.zip, opts.entryByName.get(photos[i].member)));
      slide.addImage({ data, x: PHOTO_SLOTS[i].x, y: PHOTO_SLOTS[i].y, w: PHOTO_W, h: PHOTO_H });
    }
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
