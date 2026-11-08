// Genera el PPT de testigos en el navegador con PptxGenJS (copia local en js/vendor).
// Una diapositiva por ubicación del plan, en el orden del plan. Sin evidencia -> "Pendiente".
import { readEntry } from './zip.js';

const NAVY = '202E40', INK = '253247', CORAL = 'FF7A64', GRAY = 'F1F4F6', LINE = 'AFBDCA';
const W = 13.333, H = 7.5;

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

// Reduce la foto para que el PPT no pese cientos de MB (las originales van intactas en el ZIP).
async function shrink(blob, max = 1400) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return { data: canvas.toDataURL('image/jpeg', 0.85), w, h };
}

function slots(n) {
  const x0 = 0.4, y0 = 1.75, aw = W - 0.8, ah = H - y0 - 0.55, gap = 0.2;
  const grid = n <= 1 ? [1, 1] : n === 2 ? [2, 1] : n === 3 ? [3, 1] : [2, 2];
  const [cols, rows] = grid;
  const sw = (aw - gap * (cols - 1)) / cols, sh = (ah - gap * (rows - 1)) / rows;
  return Array.from({ length: Math.max(1, n) }, (_, i) => ({ x: x0 + (i % cols) * (sw + gap), y: y0 + Math.floor(i / cols) * (sh + gap), w: sw, h: sh }));
}

/**
 * opts: { campaign, sites, selected: Map title->codes, groups: Map title->group, perSlide, zip, entryByName, onProgress }
 */
export async function buildPpt(opts) {
  await loadLib();
  const pptx = new window.PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = 'Testigos ' + opts.campaign;
  pptx.company = 'Beeyond Media';
  const campaignTitle = opts.campaign.replaceAll('-', ' ').toUpperCase();

  // Portada
  const cover = pptx.addSlide();
  cover.background = { color: NAVY };
  cover.addShape('rect', { x: 0.6, y: 3.0, w: 0.12, h: 1.3, fill: { color: CORAL }, line: { color: CORAL } });
  cover.addText(campaignTitle, { x: 0.9, y: 2.9, w: 11.5, h: 0.9, fontSize: 34, bold: true, color: 'FFFFFF', fontFace: 'Arial' });
  cover.addText('Testigos fotográficos', { x: 0.9, y: 3.7, w: 11.5, h: 0.6, fontSize: 20, color: 'D1DCE8', fontFace: 'Arial' });
  cover.addText('Beeyond', { x: W - 3.4, y: H - 0.9, w: 3, h: 0.5, fontSize: 16, bold: true, color: 'FFFFFF', align: 'right', fontFace: 'Arial' });

  let done = 0, withPhotos = 0;
  for (const site of opts.sites) {
    const chosen = (opts.selected.get(site.title) || []).filter(c => site.photos.some(p => p.code === c));
    // Si no se eligieron fotos, se usan las primeras vinculadas.
    const codes = chosen.length ? chosen : site.photos.slice(0, opts.perSlide).map(p => p.code);
    const photos = codes.map(c => site.photos.find(p => p.code === c));
    if (photos.length) withPhotos++;

    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addShape('rect', { x: 0, y: 0, w: W, h: 0.75, fill: { color: NAVY }, line: { color: NAVY } });
    slide.addText(campaignTitle, { x: 0.4, y: 0.1, w: 9, h: 0.55, fontSize: 16, color: 'FFFFFF', fontFace: 'Arial' });
    slide.addText('Beeyond', { x: W - 3.4, y: 0.1, w: 3, h: 0.55, fontSize: 16, bold: true, color: 'FFFFFF', align: 'right', fontFace: 'Arial' });
    slide.addShape('rect', { x: 0.4, y: 0.95, w: 0.09, h: 0.6, fill: { color: CORAL }, line: { color: CORAL } });
    const group = opts.groups.get(site.title);
    slide.addText([
      { text: site.title, options: { bold: true } },
      ...(group ? [{ text: '  ·  ' + group, options: { color: '566A80' } }] : []),
    ], { x: 0.6, y: 0.95, w: W - 1.0, h: 0.6, fontSize: 14, color: INK, fontFace: 'Arial', valign: 'middle', fit: 'shrink' });

    const boxes = slots(photos.length);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i], photo = photos[i];
      if (!photo) {
        slide.addShape('rect', { x: b.x, y: b.y, w: b.w, h: b.h, fill: { color: GRAY }, line: { color: LINE, dashType: 'dash', width: 1 } });
        slide.addText('Pendiente', { x: b.x, y: b.y, w: b.w, h: b.h, align: 'center', valign: 'middle', fontSize: 20, color: '566A80', fontFace: 'Arial' });
        continue;
      }
      const entry = opts.entryByName.get(photo.member);
      const img = await shrink(await readEntry(opts.zip, entry));
      const r = Math.min(b.w / img.w, b.h / img.h);
      const w = img.w * r, h = img.h * r;
      slide.addImage({ data: img.data, x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h });
    }
    const foot = [site.location, site.provider, site.city].filter(Boolean).join(' · ');
    slide.addText(foot, { x: 0.4, y: H - 0.45, w: W - 0.8, h: 0.35, fontSize: 10, color: '566A80', fontFace: 'Arial' });
    opts.onProgress?.(++done, opts.sites.length);
  }
  await pptx.writeFile({ fileName: 'testigos-' + opts.campaign + '.pptx' });
  return { slides: opts.sites.length, withPhotos, pending: opts.sites.length - withPhotos };
}
