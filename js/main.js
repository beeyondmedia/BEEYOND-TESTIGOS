import { FIREBASE_CONFIG, DOMINIO, ADMIN_PRINCIPAL } from './config.js';
import { recordsFromSheets, indexArchive, reconcile, exportList, ledgerToList, ledgerFromList, mappingsFromList, suffix, siteStatus, suggest } from './core.js';
import { openZip, readEntry, buildZip } from './zip.js';
import { readXlsx } from './xlsx.js';
import { buildPpt, buildBlankPpt, slideTexts, photoLayout, slideContent, STATUS_COLORS, STATUS_BOX } from './ppt.js';
import { analyzePpt, matchSites, pptStatus as pptStatusRaw, planUpdate, updatePpt, faltantes } from './pptmerge.js';

const $ = id => document.getElementById(id);
const perSlide = () => Number($('layout').value);
const pptStatus = (site, slide) => pptStatusRaw(site, slide, perSlide());
const pptSlide = site => state.pptMatch.get(site.title);
const DEMO = new URLSearchParams(location.search).has('demo') || !FIREBASE_CONFIG.apiKey;
const KINDS = ['plan', 'report', 'photos'];
let backend;

const state = {
  user: null, access: null,
  files: {}, parsed: {}, sheets: {}, // archivos, su lectura en caché (por firma) y la hoja usada
  zip: null, entryByName: new Map(),
  ppt: null, pptMatch: new Map(),  // PPT ya hecha (opcional) y su relación con las ubicaciones
  result: null, current: 0, filter: 'todas',
  selected: new Map(), groups: new Map(),
  urls: new Map(),
};

// ---------------------------------------------------------------- utilidades de interfaz
function node(tag, text, cls) { const el = document.createElement(tag); if (text !== undefined && text !== null) el.textContent = text; if (cls) el.className = cls; return el; }
function setMsg(el, text, kind = '') { el.textContent = text; el.className = 'msg' + (kind ? ' ' + kind : ''); el.hidden = !text; }
const message = (text, kind = '') => setMsg($('message'), text, kind === true ? 'err' : kind);
function show(screen) {
  for (const id of ['screen-loading', 'screen-login', 'screen-denied', 'shell']) $(id).hidden = id !== screen;
}
function view(name) {
  $('view-app').hidden = name !== 'app'; $('view-admin').hidden = name !== 'admin';
  for (const [id, on] of [['nav-app', name === 'app'], ['nav-admin', name === 'admin']]) {
    if (on) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current');
  }
}
function steps(n) { [...$('steps').children].forEach((s, i) => s.classList.toggle('on', i < n)); }
// "MERCADO LIBRE BUEN FIN Previa" -> "mercado-libre-buen-fin-previa"
const slug = v => String(v).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');
function cid() {
  const value = slug($('campaign').value);
  if (!value) throw Error('Escribe el nombre de la campaña.');
  if ($('campaign').value !== value) $('campaign').value = value;
  return value;
}
function explain(e) {
  if (e?.code === 'permission-denied') return 'Firestore rechazó la operación: tu cuenta no tiene alta activa o las reglas no están publicadas.';
  if (e?.code === 'unavailable') return 'Sin conexión con Firebase. Revisa tu internet e inténtalo de nuevo.';
  return e?.message || String(e);
}
const fileSig = f => `${f.name}:${f.size}:${f.lastModified}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function showFileName(kind) {
  const f = state.files[kind], el = $(kind + '-name');
  el.replaceChildren();
  if (!f) return;
  el.append(f.name + ' · ' + (f.size / 1048576).toFixed(1) + ' MB');
  if (kind === 'ppt') {
    const x = node('button', 'Quitar', 'btn small'); x.type = 'button'; x.style.marginLeft = '6px';
    x.onclick = e => { e.preventDefault(); state.files.ppt = null; state.ppt = null; $('ppt').value = ''; showFileName('ppt'); if (state.result) render(state.result, null, true); };
    el.append(x);
  }
}

// ---------------------------------------------------------------- fotos (miniaturas desde el ZIP local)
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
function readError(e) {
  if (['NotReadableError', 'NotFoundError', 'SecurityError'].includes(e?.name)) {
    return 'El navegador ya no puede leer el ZIP: se movió, se renombró, cambió o se está sincronizando (OneDrive / Drive) después de elegirlo. Vuelve a elegir el ZIP (de preferencia copiado en Descargas o Escritorio) y presiona Revisar.';
  }
  return e?.message || String(e);
}
function photoUrl(photo) {
  if (!state.urls.has(photo.code)) {
    const entry = state.entryByName.get(photo.member);
    const p = entry
      ? readEntry(state.zip, entry, MIME[suffix(photo.member)] || '').then(b => URL.createObjectURL(b))
      : Promise.reject(new Error('La foto no está en el ZIP cargado. Vuelve a elegir el ZIP y presiona Revisar.'));
    state.urls.set(photo.code, p);
    p.catch(e => { console.error(photo.member, e); if (!state.readWarned) { state.readWarned = true; message(readError(e), 'err'); } });
  }
  return state.urls.get(photo.code);
}
function picture(photo) {
  const img = node('img'); img.alt = 'Evidencia ' + photo.code; img.decoding = 'async';
  photoUrl(photo).then(u => { img.src = u; }, () => { img.alt = 'No se pudo leer ' + photo.code; img.title = 'Revisa el aviso de arriba'; });
  return img;
}
function resetPhotos() { for (const p of state.urls.values()) p.then(u => URL.revokeObjectURL(u), () => {}); state.urls.clear(); state.readWarned = false; }

// ---------------------------------------------------------------- procesamiento
async function parse(kind, file) {
  const cache = state.parsed[kind];
  if (cache && cache.sig === fileSig(file)) return cache.value;
  let value;
  if (kind === 'plan') { message('Leyendo plan ' + file.name + '…'); const r = await recordsFromSheets(await readXlsx(file), ['UBICACION|DIRECCION', 'NOMBRECRUDOS'], 'el plan'); value = r.rows; state.sheets.plan = r.sheet; }
  if (kind === 'report') { message('Leyendo reporte ' + file.name + '…'); const r = await recordsFromSheets(await readXlsx(file), ['DIRECCION', 'FOTOCODIGOS'], 'el reporte'); value = r.rows; state.sheets.report = r.sheet; }
  if (kind === 'photos') {
    message('Leyendo índice de ' + file.name + '…');
    const zip = await openZip(file);
    value = { zip, archives: indexArchive(zip.entries.map(e => e.name)) };
  }
  if (kind === 'ppt') { message('Leyendo diapositivas de ' + file.name + '…'); value = await analyzePpt(file); }
  state.parsed[kind] = { sig: fileSig(file), value };
  return value;
}

function apply(data, firma) {
  const result = reconcile(state.parsed.report.value, state.parsed.plan.value, state.parsed.photos.value.archives,
    mappingsFromList(data.equivalencias), ledgerFromList(data.numeracion));
  const sameLot = !firma || data.loteFirma === firma;
  const seleccion = sameLot ? (data.seleccion || []) : [];
  const next = { ...data, numeracion: ledgerToList(result.ledger), seleccion, loteFirma: firma || data.loteFirma || '' };
  return { next, value: { result, seleccion, cleared: !sameLot && (data.seleccion || []).length > 0 } };
}

async function load() {
  const button = $('load'); button.disabled = true;
  try {
    const id = cid();
    for (const kind of KINDS) {
      if (!state.files[kind]) throw Error('Falta elegir: ' + { plan: 'plan XLSX', report: 'reporte XLSX', photos: 'ZIP de fotografías' }[kind]);
    }
    for (const kind of KINDS) await parse(kind, state.files[kind]);
    // Siempre sincroniza el ZIP leído con el que usan miniaturas y descargas
    // (antes, si algo fallaba después de leerlo, el siguiente intento quedaba sin fotos).
    if (state.zip !== state.parsed.photos.value.zip) {
      resetPhotos();
      state.zip = state.parsed.photos.value.zip;
      state.entryByName = new Map(state.zip.entries.map(e => [e.name, e]));
    }
    state.ppt = state.files.ppt ? await parse('ppt', state.files.ppt) : null;
    message('Conciliando y guardando numeración de la campaña…');
    const firma = KINDS.map(k => fileSig(state.files[k])).join('|');
    const out = await backend.updateCampaign(id, data => apply(data, firma));
    render(out.result, out.seleccion);
    const pend = new Set(out.result.unresolved.map(r => r.key)).size;
    const hojas = ` Plan: hoja ${state.sheets.plan}. Reporte: hoja ${state.sheets.report}.` +
      (out.result.skipped?.length ? ` Se omitieron ${plural(out.result.skipped.length, 'renglón', 'renglones')} del plan sin Nombre Crudos propio (${[...new Set(out.result.skipped)].join(', ')}).` : '');
    message('Lote listo' + (out.cleared ? ' (lote nuevo: se limpió la selección anterior)' : '') + '.' +
      (pend ? ` Confirma ${plural(pend, 'dirección', 'direcciones')} en el paso 2.` : '') +
      (state.ppt ? ` PPT cargada: ${plural(state.ppt.slides.length, 'diapositiva', 'diapositivas')}.` : '') + hojas, 'ok');
    refreshCampaigns();
  } catch (e) { console.error(e); message(readError(e) === (e?.message || String(e)) ? explain(e) : readError(e), 'err'); }
  finally { button.disabled = false; }
}

// ---------------------------------------------------------------- render
function kpi(n, label, main = false) { const d = node('div', undefined, 'kpi' + (main ? ' main' : '')); d.append(node('div', n, 'n'), node('div', label, 'l')); return d; }

function render(result, seleccion, keepSelection = false) {
  state.result = result; state.current = Math.min(state.current, Math.max(0, result.sites.length - 1));
  if (!keepSelection) {
    state.selected.clear(); state.groups.clear();
    const valid = new Map(result.sites.map(s => [s.title, new Set(s.photos.map(p => p.code))]));
    for (const s of seleccion || []) {
      if (!valid.has(s.title)) continue;
      state.selected.set(s.title, s.codes.filter(c => valid.get(s.title).has(c)));
      state.groups.set(s.title, s.group || '');
    }
  }
  state.pptMatch = state.ppt ? matchSites(state.ppt, result.sites) : new Map();
  if (!state.ppt && state.filter === 'ppt') state.filter = 'todas';
  for (const id of ['review', 'editor', 'delivery']) $(id).hidden = false;
  steps(4);
  const c = result.counts;
  const withPhotos = result.sites.filter(s => s.photos.length).length;
  $('summary').replaceChildren(
    kpi(result.sites.length, 'ubicaciones en el plan', true),
    kpi(withPhotos, 'con fotos'),
    kpi(result.sites.length - withPhotos, 'sin fotos'),
    kpi(c.linked, 'fotos vinculadas'),
    kpi(`${c.present}/${c.referenced}`, 'códigos del reporte en el ZIP'),
    kpi(c.extra, 'fotos sin referencia'),
  );
  $('extras').textContent = result.extra.join(', ') || 'Ninguno';
  $('extra-label').textContent = 'Fotos del ZIP sin referencia en el reporte (' + result.extra.length + ')';
  $('issues').textContent = 'Faltantes: ' + (result.missing.join(', ') || 'ninguno') + '\nConflictos: ' + (result.conflicts.join(', ') || 'ninguno');
  const list = $('unresolved'); list.replaceChildren();
  const unique = new Map(result.unresolved.map(r => [r.key, r]));
  for (const row of unique.values()) {
    const line = node('div', undefined, 'review-row');
    const label = node('div'); label.append(node('b', row.address || '(sin dirección)'), node('span', [row.provider, plural(row.codes.length, 'foto', 'fotos')].filter(Boolean).join(' · '), 'sub'));
    const select = node('select'); select.setAttribute('aria-label', 'Nombre Crudos para ' + row.address);
    const blank = node('option', 'Elegir Nombre Crudos…'); blank.value = ''; select.append(blank);
    // Primero las más parecidas (la mejor ya seleccionada; solo se guarda al confirmar).
    const sug = suggest(result.sites, row);
    if (sug.length) {
      const g = node('optgroup'); g.label = 'Más parecidas';
      for (const { site } of sug) { const o = node('option', site.title + ' · ' + site.location); o.value = site.title; g.append(o); }
      select.append(g);
      // Solo se preselecciona si es claramente la mejor (muy parecida y sin otra cerca).
      if (sug[0].score >= 0.75 && (sug.length < 2 || sug[0].score - sug[1].score >= 0.2)) { select.value = sug[0].site.title; line.classList.add('suggested'); }
    }
    const all = node('optgroup'); all.label = 'Todas las ubicaciones del plan';
    for (const site of result.sites) { const o = node('option', site.title); o.value = site.title; all.append(o); }
    select.append(all);
    const button = node('button', 'Confirmar', 'btn primary'); button.type = 'button';
    button.onclick = async () => {
      if (!select.value) return;
      button.disabled = true;
      try {
        const out = await backend.updateCampaign(cid(), data => {
          const eq = (data.equivalencias || []).filter(x => x.key !== row.key);
          eq.push({ key: row.key, title: select.value });
          return apply({ ...data, equivalencias: eq }, null);
        });
        render(out.result, out.seleccion);
        message('Equivalencia guardada para toda la campaña.', 'ok');
      } catch (e) { message(explain(e), 'err'); button.disabled = false; }
    };
    if (select.value) label.append(node('span', 'Sugerencia: revisa que sea la correcta y confirma.', 'sub sug'));
    else if (sug.length) label.append(node('span', 'Las más parecidas están al inicio de la lista.', 'sub'));
    line.append(label, select, button); list.append(line);
  }
  if (!unique.size) list.append(node('div', 'Todas las direcciones del reporte tienen una ubicación del plan.', 'msg ok'));
  drawFilters(); drawSites(); drawEditor(); drawDelivery();
  $('export').disabled = !c.linked || !!result.conflicts.length;
  $('export-ppt').disabled = !result.sites.length;
  if (!$('ppt-title').value) $('ppt-title').value = defaultTitle();
}

// ---------------------------------------------------------------- paso 3: filtros y lista
const FILTERS = [
  ['todas', 'Todas', () => true],
  ['con', 'Con fotos', s => s.photos.length > 0],
  ['sin', 'Pendientes (sin fotos)', s => !s.photos.length],
  ['elegir', 'Con fotos sin elegir', s => s.photos.length > 0 && !(state.selected.get(s.title) || []).length],
  ['coment', 'Con comentarios del reporte', s => ['Con observaciones', 'En revisión'].includes(siteStatus(s)?.estatus)],
  ['parcial', 'Incompletas en PPT', s => pptStatus(s, pptSlide(s)) === 'parcial'],
  ['ppt', 'Por agregar o completar en PPT', s => ['falta', 'completar', 'parcial'].includes(pptStatus(s, pptSlide(s)))],
];
const activeFilters = () => FILTERS.filter(([id]) => !['ppt', 'parcial'].includes(id) || state.ppt);
function visibleSites() {
  const test = FILTERS.find(f => f[0] === state.filter)?.[2] || (() => true);
  const q = $('site-filter').value.trim().toLowerCase();
  return state.result.sites.map((site, index) => ({ site, index }))
    .filter(({ site }) => test(site) && (!q || (site.location + ' ' + site.title).toLowerCase().includes(q)));
}
function drawFilters() {
  const seg = $('filters'); seg.replaceChildren();
  for (const [id, label, test] of activeFilters()) {
    const b = node('button'); b.type = 'button';
    b.append(label, node('b', state.result.sites.filter(test).length));
    b.setAttribute('aria-pressed', String(state.filter === id));
    b.onclick = () => { state.filter = id; drawFilters(); drawSites(true); };
    seg.append(b);
  }
}
const PPT_PILL = { ok: ['En PPT', 'p-ok'], falta: ['Falta en PPT', 'p-new'], completar: ['Sin fotos en PPT · elige fotos', 'p-warn'], pendiente: ['Pendiente en PPT', 'p-idle'], parcial: ['Incompleta en PPT', 'p-warn'] };
const pptPill = site => {
  const st = pptStatus(site, pptSlide(site));
  if (st !== 'parcial') return PPT_PILL[st];
  const n = pptSlide(site).photos, f = faltantes(pptSlide(site), perSlide());
  return [`En PPT ${n} de ${Math.min(4, perSlide())} · faltan ${f}`, 'p-warn'];
};
function drawSites(jump = false) {
  const target = $('sites'); target.replaceChildren();
  const list = visibleSites();
  if (jump && list.length && !list.some(x => x.index === state.current)) { state.current = list[0].index; drawEditor(); }
  for (const { site, index } of list) {
    const button = node('button'); button.type = 'button';
    button.append(node('span', site.location || site.title, 't'));
    const tags = node('span', undefined, 'tags');
    const picked = (state.selected.get(site.title) || []).length;
    tags.append(site.photos.length ? node('span', plural(site.photos.length, 'foto', 'fotos'), 'pill p-ok') : node('span', 'Sin fotos', 'pill p-idle'));
    if (picked) tags.append(node('span', plural(picked, 'elegida', 'elegidas'), 'pill p-new'));
    const stt = siteStatus(site); if (stt && stt.estatus !== 'Pendiente') { const pl = node('span', stt.estatus, 'pill ' + STATUS_PILL[stt.estatus]); pl.title = stt.comentario; tags.append(pl); }
    if (state.ppt) { const [t, cls] = pptPill(site); tags.append(node('span', t, 'pill ' + cls)); }
    button.append(tags);
    button.className = index === state.current ? 'active' : '';
    button.onclick = () => { state.current = index; drawSites(); drawEditor(); };
    target.append(button);
  }
  if (!list.length) target.append(node('div', 'Ninguna ubicación con este filtro.', 'empty'));
}


function drawSlide() {
  const site = state.result.sites[state.current]; if (!site) return;
  const t = slideTexts(site);
  $('slide-campaign').textContent = $('ppt-title').value.trim() || defaultTitle();
  $('slide-location').textContent = t.location; $('slide-format').textContent = t.format; $('slide-city').textContent = t.city;
  const grid = $('slide-grid'); grid.replaceChildren();
  const parcial = isParcial(site);
  const prev = parcial ? pptSlide(site).photos : 0;
  const n = Math.min(4, perSlide());
  const photos = parcial
    ? (state.selected.get(site.title) || []).map(c => site.photos.find(p => p.code === c)).filter(Boolean).slice(0, faltantes(pptSlide(site), perSlide()))
    : slideContent(site, state.selected.get(site.title), n).photos;
  const status = siteStatus(site);
  const place = (slot, b) => Object.assign(slot.style, { left: b.x / 10 * 100 + '%', top: b.y / 5.625 * 100 + '%', width: b.w / 10 * 100 + '%', height: b.h / 5.625 * 100 + '%' });
  const total = prev + photos.length;
  // Acomodo de "Fotos por diapositiva"; los espacios sin foto quedan vacíos (en PowerPoint se llenan con un clic).
  const slotsN = Math.max(n, total);
  const boxes = photoLayout(slotsN);
  for (let i = 0; i < prev; i++) { const slot = node('div', 'Foto que ya está en tu PPT', 'slot'); place(slot, boxes[i]); grid.append(slot); }
  photos.forEach((photo, i) => { const slot = node('div', undefined, 'slot'); place(slot, boxes[prev + i]); slot.append(picture(photo)); grid.append(slot); });
  for (let i = total; i < slotsN; i++) { const slot = node('div', `Foto ${i + 1} · espacio vacío`, 'slot empty'); place(slot, boxes[i]); grid.append(slot); }
  if (status) {
    const card = node('div', undefined, 'slot card'); place(card, STATUS_BOX);
    card.style.borderColor = '#' + STATUS_COLORS[status.estatus];
    const h = node('b', status.estatus.toUpperCase()); h.style.color = '#' + STATUS_COLORS[status.estatus];
    card.append(h, node('span', status.comentario)); grid.append(card);
  }
}

const STATUS_PILL = { 'Con observaciones': 'p-bad', 'En revisión': 'p-warn', 'Pendiente': 'p-idle' };
const isParcial = site => state.ppt && pptStatus(site, pptSlide(site)) === 'parcial';
const maxPhotos = site => isParcial(site) ? faltantes(pptSlide(site), perSlide()) : Math.min(4, perSlide());

function drawEditor() {
  const site = state.result.sites[state.current];
  const grid = $('photos-grid'); grid.replaceChildren();
  if (!site) return;
  $('site-name').textContent = site.title;
  const st = state.ppt ? ' · ' + pptPill(site)[0] : '';
  $('site-sub').textContent = [site.location, site.provider, site.city].filter(Boolean).join(' · ') + st;
  const stt = siteStatus(site);
  $('site-status').hidden = !stt || stt.estatus === 'Pendiente';
  if (stt) $('site-status').textContent = `Reporte: ${stt.estatus} — ${stt.comentario}. Va en un recuadro en el panel coral de la diapositiva y la app de Comprobación lo registra como estatus y comentario.`;
  if (isParcial(site)) {
    const n = pptSlide(site).photos, f = faltantes(pptSlide(site), perSlide());
    $('site-status').hidden = false;
    $('site-status').textContent = `Tu PPT ya tiene ${plural(n, 'foto', 'fotos')} de esta ubicación. Elige ${f === 1 ? 'la foto que falta' : `las ${f} que faltan`} (por ejemplo, la otra versión): al actualizar se agregan a la misma diapositiva junto con las que ya tiene. Si no eliges, la diapositiva se queda igual. Si aparecen marcadas fotos que ya están en tu PPT, desmárcalas para no repetirlas.` + (stt && stt.estatus !== 'Pendiente' ? ` Reporte: ${stt.estatus} — ${stt.comentario}.` : '');
  }
  const codes = state.selected.get(site.title) || [];
  for (const photo of site.photos) {
    const card = node('div', undefined, 'photo' + (codes.includes(photo.code) ? ' on' : ''));
    card.append(picture(photo));
    const label = node('label');
    const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = codes.includes(photo.code);
    checkbox.onchange = () => {
      let picked = state.selected.get(site.title) || [];
      if (checkbox.checked) {
        if (picked.length >= maxPhotos(site)) { checkbox.checked = false; message(isParcial(site) ? `A esta diapositiva de tu PPT solo le ${maxPhotos(site) === 1 ? 'falta 1 foto' : 'faltan ' + maxPhotos(site) + ' fotos'}.` : `Elige como máximo ${maxPhotos(site)} fotos para esta diapositiva (cámbialo en Fotos por diapositiva).`, 'warn'); return; }
        picked = [...picked, photo.code];
      } else picked = picked.filter(c => c !== photo.code);
      state.selected.set(site.title, picked);
      card.classList.toggle('on', checkbox.checked);
      drawSlide(); if (state.ppt) drawDelivery();
    };
    card.onclick = e => { if (e.target !== checkbox && e.target.tagName !== 'LABEL') { checkbox.checked = !checkbox.checked; checkbox.onchange(); } };
    label.append(checkbox, node('span', photo.code));
    card.append(label, node('code', photo.filename));
    grid.append(card);
  }
  if (!site.photos.length) grid.append(node('div', 'Pendiente: no hay fotos vinculadas para esta ubicación en este lote.', 'nofotos'));
  drawSlide();
}

async function saveSelection() {
  const button = $('save'); button.disabled = true;
  try {
    const site = state.result.sites[state.current];
    const codes = state.selected.get(site.title) || [];
    const group = state.groups.get(site.title) || '';
    const validCodes = new Set(site.photos.map(p => p.code));
    if (codes.length > 4 || new Set(codes).size !== codes.length) throw Error('Elige hasta cuatro fotos diferentes.');
    if (!codes.every(c => validCodes.has(c))) throw Error('Foto no válida para la ubicación.');
    await backend.updateCampaign(cid(), data => {
      const seleccion = (data.seleccion || []).filter(s => s.title !== site.title);
      if (codes.length || group) seleccion.push({ title: site.title, codes, group });
      return { next: { ...data, seleccion }, value: null };
    });
    drawFilters(); drawSites(); drawDelivery();
    message('Selección guardada para ' + (site.location || site.title) + '.', 'ok');
  } catch (e) { message(explain(e), 'err'); }
  finally { button.disabled = false; }
}

// ---------------------------------------------------------------- paso 4
function drawDelivery() {
  const box = $('ppt-plan');
  $('update-ppt').hidden = !state.ppt;
  $('export-ppt').textContent = state.ppt ? 'Descargar PPT completa nueva' : 'Descargar PPT';
  if (!state.ppt) { box.hidden = true; return; }
  const { actions, incompletas } = planUpdate(state.ppt, state.result.sites, { perSlide: perSlide(), selected: state.selected });
  const add = actions.filter(a => a.type === 'add').length, rep = actions.filter(a => a.type === 'replace').length, fill = actions.filter(a => a.type === 'fill').length;
  const pend = state.result.sites.filter(s => pptStatus(s, state.pptMatch.get(s.title)) === 'pendiente').length;
  setMsg(box, `PPT cargada: ${state.ppt.name} (${plural(state.ppt.slides.length, 'diapositiva', 'diapositivas')}).\n` +
    (actions.length ? 'Al actualizar: ' + [add && `se agregarán ${plural(add, 'ubicación que falta', 'ubicaciones que faltan')}`, rep && `${rep === 1 ? 'se completará 1 pendiente' : `se completarán ${rep} pendientes`} con fotos nuevas`, fill && `se agregarán las fotos elegidas a ${plural(fill, 'diapositiva incompleta', 'diapositivas incompletas')} (en la misma diapositiva)`].filter(Boolean).join(', ') + '. Lo demás queda igual.' : 'La PPT ya tiene todas las ubicaciones; no hay nada por agregar ni completar.') +
    (pend ? ` ${plural(pend, 'ubicación sigue', 'ubicaciones siguen')} como Pendiente porque no tienen fotos en este lote.` : '') +
    (incompletas.length ? `\n${plural(incompletas.length, 'diapositiva incompleta o sin fotos', 'diapositivas incompletas o sin fotos')} de tu PPT sin fotos elegidas: ${incompletas.length === 1 ? 'se queda' : 'se quedan'} igual. Para completarlas, usa el filtro "Por agregar o completar en PPT" del paso 3 y elige las fotos.` : ''),
  actions.length ? 'warn' : 'ok');
  $('update-ppt').disabled = !actions.length;
  $('update-ppt').textContent = actions.length ? `Actualizar PPT cargada (${plural(actions.length, 'cambio', 'cambios')})` : 'Actualizar PPT cargada';
}

async function exportZip() {
  const button = $('export'); button.disabled = true;
  try {
    message('Armando ZIP…');
    const items = exportList(state.result).map(p => ({ name: p.filename, zip: state.zip, entry: state.entryByName.get(p.member) }));
    const blob = await buildZip(items);
    const a = node('a'); a.href = URL.createObjectURL(blob); a.download = 'fotos-renombradas-' + cid() + '.zip';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    message(`ZIP listo: ${plural(items.length, 'foto renombrada', 'fotos renombradas')}.`, 'ok');
  } catch (e) { message(readError(e), 'err'); }
  finally { button.disabled = false; }
}

const titleKey = id => 'beeyond-ppt-title:' + id;
function defaultTitle() {
  let saved = null;
  try { saved = localStorage.getItem(titleKey(cid())); } catch { /* sin almacenamiento */ }
  return saved || $('campaign').value.replaceAll('-', ' ').toUpperCase();
}
function pptTitle() {
  const title = $('ppt-title').value.trim() || defaultTitle();
  try { localStorage.setItem(titleKey(cid()), title); } catch { /* sin almacenamiento */ }
  return title;
}
const safeFile = s => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
const pptOpts = title => ({
  title, sites: state.result.sites, selected: state.selected,
  perSlide: Number($('layout').value), zip: state.zip, entryByName: state.entryByName,
  onProgress: (n, total) => message(typeof n === 'string' ? n : `Armando diapositivas… ${n} de ${total}`),
});

async function exportPpt() {
  const button = $('export-ppt'); button.disabled = true;
  try {
    const title = pptTitle();
    message('Armando PPT…');
    const out = await buildPpt({ ...pptOpts(title), fileName: safeFile(title) + '.pptx' });
    message(`PPT lista: ${plural(out.slides, 'diapositiva', 'diapositivas')} (${out.withPhotos} con fotos, ${out.pending} pendientes).`, 'ok');
  } catch (e) { console.error(e); message(readError(e), 'err'); }
  finally { button.disabled = false; }
}

// PPT en blanco: solo con el plan, sin reporte ni fotos.
async function exportBlank() {
  const button = $('blank-ppt'); button.disabled = true;
  try {
    if (!state.files.plan) throw Error('Elige primero el plan de campaña (XLSX).');
    const plan = await parse('plan', state.files.plan);
    const { sites, skipped } = reconcile([], plan, new Map());
    if (!sites.length) throw Error('El plan no tiene ubicaciones con Nombre Crudos.');
    const title = $('blank-title').value.trim() || defaultTitle();
    $('blank-title').value = title;
    try { localStorage.setItem(titleKey(cid()), title); } catch { /* sin almacenamiento */ }
    const slots = Number($('blank-slots').value);
    message('Armando PPT en blanco…');
    await buildBlankPpt({ title, sites, slots, fileName: safeFile(title) + ' (en blanco).pptx', onProgress: (n, t) => message(`Armando diapositivas… ${n} de ${t}`) });
    message(`PPT en blanco lista: ${plural(sites.length, 'diapositiva', 'diapositivas')} con ${plural(slots, 'espacio', 'espacios')} para fotos (plan: hoja ${state.sheets.plan})${skipped.length ? `; se omitieron ${plural(skipped.length, 'renglón', 'renglones')} sin Nombre Crudos propio (${[...new Set(skipped)].join(', ')})` : ''}. En PowerPoint, haz clic en el ícono de imagen de cada espacio para insertar la foto.`, 'ok');
  } catch (e) { console.error(e); message(explain(e), 'err'); }
  finally { button.disabled = false; }
}

async function exportUpdate() {
  const button = $('update-ppt'); button.disabled = true;
  try {
    const title = pptTitle();
    message('Actualizando PPT…');
    const base = state.ppt.name.replace(/\.pptx$/i, '');
    const out = await updatePpt({ ...pptOpts(title), analysis: state.ppt, fileName: safeFile(base) + ' (actualizada).pptx' });
    message('PPT actualizada: ' + [out.added && plural(out.added, 'diapositiva agregada', 'diapositivas agregadas'), out.replaced && plural(out.replaced, 'pendiente completada', 'pendientes completadas'), out.filled && plural(out.filled, 'incompleta completada', 'incompletas completadas')].filter(Boolean).join(', ') + `. Ahora tiene ${out.total}; el resto quedó igual.`, 'ok');
  } catch (e) { console.error(e); message(explain(e), 'err'); }
  finally { button.disabled = false; }
}

async function refreshCampaigns() {
  try {
    const list = await backend.listCampaigns();
    $('campaign-list').replaceChildren(...list.map(id => { const o = node('option'); o.value = id; return o; }));
  } catch (e) { console.warn(e); }
}

// ---------------------------------------------------------------- administración de usuarios
async function drawUsers() {
  const body = $('users-body'); body.replaceChildren();
  try {
    for (const u of await backend.listUsers()) {
      const tr = node('tr');
      const locked = u.email === ADMIN_PRINCIPAL;
      const rol = node('select'); rol.disabled = locked;
      for (const [v, t] of [['usuario', 'Usuario'], ['admin', 'Administrador']]) { const o = node('option', t); o.value = v; o.selected = u.rol === v; rol.append(o); }
      rol.onchange = () => updateUser(u.email, { rol: rol.value, activo: u.activo });
      const pill = node('span', u.activo ? 'Activo' : 'Baja', 'pill ' + (u.activo ? 'p-ok' : 'p-bad'));
      const toggle = node('button', u.activo ? 'Dar de baja' : 'Reactivar', 'btn small' + (u.activo ? ' danger' : '')); toggle.type = 'button'; toggle.disabled = locked;
      toggle.onclick = () => updateUser(u.email, { rol: u.rol, activo: !u.activo });
      const tdRol = node('td'); tdRol.append(rol);
      const tdPill = node('td'); tdPill.append(pill);
      const tdBtn = node('td'); tdBtn.append(toggle);
      tr.append(node('td', u.email + (locked ? ' (principal)' : '')), tdRol, tdPill, tdBtn);
      body.append(tr);
    }
  } catch (e) { setMsg($('admin-msg'), explain(e), 'err'); }
}
async function updateUser(email, data, isNew = false) {
  try { await backend.saveUser(email, data, isNew); setMsg($('admin-msg'), 'Guardado: ' + email, 'ok'); }
  catch (e) { setMsg($('admin-msg'), explain(e), 'err'); }
  drawUsers();
}

// ---------------------------------------------------------------- arranque
function denied(text) { $('denied-msg').textContent = text; show('screen-denied'); }
async function onUser(user) {
  state.user = user;
  if (!user) { show('screen-login'); return; }
  $('who-email').textContent = user.email;
  if (!user.email.endsWith('@' + DOMINIO) || !user.verified) return denied(`La cuenta ${user.email} no es una cuenta verificada de @${DOMINIO}. Entra con tu correo de la empresa.`);
  try { state.access = await backend.getAccess(); }
  catch (e) { return denied(explain(e)); }
  if (!state.access?.activo) return denied(`Tu cuenta ${user.email} no tiene alta activa. Pide a ${ADMIN_PRINCIPAL} que te dé de alta en Usuarios.`);
  $('nav-admin').hidden = state.access.rol !== 'admin';
  show('shell'); view('app');
  refreshCampaigns();
}

function themeLabel() { $('btn-theme').textContent = document.documentElement.dataset.theme === 'dark' ? 'Tema claro' : 'Tema oscuro'; }

async function start() {
  try { backend = await import(DEMO ? './backend-demo.js' : './backend-firebase.js'); }
  catch (e) {
    console.error(e);
    document.querySelector('#screen-loading .loading-msg').textContent = 'No se pudo cargar Firebase. Revisa tu conexión a internet o si la red de la oficina bloquea www.gstatic.com.';
    return;
  }
  $('demo-banner').hidden = !DEMO;
  $('btn-login').onclick = async () => {
    setMsg($('login-msg'), '');
    try { await backend.signIn(); }
    catch (e) {
      const msgs = {
        'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permite ventanas emergentes para este sitio.',
        'auth/popup-closed-by-user': 'Se cerró la ventana de Google antes de terminar.',
        'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase (Authentication › Configuración › Dominios autorizados).',
        'auth/operation-not-allowed': 'El acceso con Google no está habilitado en Firebase (Authentication › Método de acceso).',
      };
      setMsg($('login-msg'), msgs[e.code] || explain(e), 'err');
    }
  };
  for (const id of ['btn-logout', 'btn-logout-2']) $(id).onclick = () => backend.logOut();
  $('nav-app').onclick = e => { e.preventDefault(); view('app'); };
  $('nav-admin').onclick = e => { e.preventDefault(); view('admin'); drawUsers(); };
  themeLabel();
  $('btn-theme').onclick = () => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    if (dark) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('bym-tema', dark ? 'dark' : 'light'); } catch { /* sin almacenamiento */ }
    themeLabel();
  };
  $('btn-add-user').onclick = () => {
    const email = $('new-email').value.trim().toLowerCase();
    if (!new RegExp('^[a-z0-9._%+-]+@' + DOMINIO.replace('.', '\\.') + '$').test(email)) { setMsg($('admin-msg'), `Escribe un correo @${DOMINIO}.`, 'err'); return; }
    $('new-email').value = '';
    updateUser(email, { rol: $('new-rol').value, activo: true }, true);
  };
  for (const kind of [...KINDS, 'ppt']) $(kind).onchange = () => { const f = $(kind).files[0]; if (f) { state.files[kind] = f; showFileName(kind); } };
  $('load').onclick = load;
  $('save').onclick = saveSelection;
  $('export').onclick = exportZip;
  $('export-ppt').onclick = exportPpt;
  $('update-ppt').onclick = exportUpdate;
  $('blank-ppt').onclick = exportBlank;
  $('blank-box').ontoggle = () => { if ($('blank-box').open && !$('blank-title').value) { try { $('blank-title').value = defaultTitle(); } catch { /* sin campaña */ } } };
  $('site-filter').oninput = () => state.result && drawSites(true);
  $('ppt-title').oninput = () => state.result && drawSlide();
  $('layout').onchange = () => {
    if (!state.result) return;
    const site = state.result.sites[state.current];
    state.selected.set(site.title, (state.selected.get(site.title) || []).slice(0, Number($('layout').value)));
    drawFilters(); drawSites(); drawEditor(); drawDelivery();
  };
  $('campaign').onchange = () => { const v = slug($('campaign').value); if (v) $('campaign').value = v; };
  $('campaign').oninput = () => {
    state.result = null; state.selected.clear(); $('ppt-title').value = '';
    for (const id of ['review', 'editor', 'delivery']) $(id).hidden = true;
    steps(1);
    message('Presiona Revisar para cargar esta campaña con los archivos elegidos.');
  };
  backend.init(onUser);
}

start();
