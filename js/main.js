import { FIREBASE_CONFIG, DOMINIO, ADMIN_PRINCIPAL } from './config.js';
import { records, indexArchive, reconcile, exportList, ledgerToList, ledgerFromList, mappingsFromList, suffix } from './core.js';
import { openZip, readEntry, buildZip } from './zip.js';
import { readXlsx } from './xlsx.js';
import { buildPpt } from './ppt.js';

const $ = id => document.getElementById(id);
const DEMO = new URLSearchParams(location.search).has('demo') || !FIREBASE_CONFIG.apiKey;
let backend;

const state = {
  user: null, access: null,
  files: {}, parsed: {},           // archivos y su lectura en caché (por objeto File)
  zip: null, entryByName: new Map(),
  result: null, current: 0,
  selected: new Map(), groups: new Map(),
  urls: new Map(),
};

// ---------------------------------------------------------------- utilidades de interfaz
function node(tag, text, cls) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; }
function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; }
function show(screen) {
  for (const id of ['screen-loading', 'screen-login', 'screen-denied', 'screen-app', 'screen-admin']) $(id).hidden = id !== 'screen-' + screen;
  $('who').hidden = !['app', 'admin', 'denied'].includes(screen);
}
function cid() {
  const value = $('campaign').value.trim();
  if (!/^[a-z0-9-]{1,70}$/.test(value)) throw Error('Identificador inválido: usa letras minúsculas, números y guiones.');
  return value;
}
function explain(e) {
  if (e?.code === 'permission-denied') return 'Firestore rechazó la operación: tu cuenta no tiene alta activa o las reglas no están publicadas.';
  if (e?.code === 'unavailable') return 'Sin conexión con Firebase. Revisa tu internet e inténtalo de nuevo.';
  return e?.message || String(e);
}
const fileSig = f => `${f.name}:${f.size}:${f.lastModified}`;

// ---------------------------------------------------------------- fotos (miniaturas desde el ZIP local)
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
function photoUrl(photo) {
  if (!state.urls.has(photo.code)) {
    const entry = state.entryByName.get(photo.member);
    state.urls.set(photo.code, readEntry(state.zip, entry, MIME[suffix(photo.member)] || '').then(b => URL.createObjectURL(b)));
  }
  return state.urls.get(photo.code);
}
function picture(photo) {
  const img = node('img'); img.alt = 'Evidencia ' + photo.code; img.decoding = 'async';
  photoUrl(photo).then(u => { img.src = u; }, () => { img.alt = 'No se pudo leer ' + photo.code; });
  return img;
}
function resetPhotos() { for (const p of state.urls.values()) p.then(u => URL.revokeObjectURL(u), () => {}); state.urls.clear(); }

// ---------------------------------------------------------------- procesamiento
async function parse(kind, file) {
  const cache = state.parsed[kind];
  if (cache && cache.sig === fileSig(file)) return cache.value;
  let value;
  if (kind === 'plan') { message('Leyendo plan ' + file.name + '…'); value = records(await readXlsx(file), ['UBICACION', 'NOMBRECRUDOS'], 'el plan'); }
  if (kind === 'report') { message('Leyendo reporte ' + file.name + '…'); value = records(await readXlsx(file), ['DIRECCION', 'FOTOCODIGOS'], 'el reporte'); }
  if (kind === 'photos') {
    message('Leyendo índice de ' + file.name + '…');
    const zip = await openZip(file);
    value = { zip, archives: indexArchive(zip.entries.map(e => e.name)) };
  }
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
    for (const kind of ['plan', 'report', 'photos']) {
      const picked = $(kind).files[0];
      if (picked) state.files[kind] = picked;
      if (!state.files[kind]) throw Error('Falta elegir: ' + { plan: 'plan XLSX', report: 'reporte XLSX', photos: 'ZIP de fotografías' }[kind]);
    }
    const before = state.parsed.photos?.sig;
    for (const kind of ['plan', 'report', 'photos']) await parse(kind, state.files[kind]);
    if (state.parsed.photos.sig !== before) {
      resetPhotos();
      state.zip = state.parsed.photos.value.zip;
      state.entryByName = new Map(state.zip.entries.map(e => [e.name, e]));
    }
    message('Conciliando y guardando numeración de la campaña…');
    const firma = ['plan', 'report', 'photos'].map(k => fileSig(state.files[k])).join('|');
    const out = await backend.updateCampaign(id, data => apply(data, firma));
    render(out.result, out.seleccion);
    for (const kind of ['plan', 'report', 'photos']) $(kind).value = '';
    message('Lote listo' + (out.cleared ? ' (lote nuevo: se limpió la selección anterior)' : '') + '. Confirma las ubicaciones pendientes antes de exportar.');
    refreshCampaigns();
  } catch (e) { console.error(e); message(explain(e), true); }
  finally { button.disabled = false; }
}

// ---------------------------------------------------------------- render
function render(result, seleccion) {
  state.result = result; state.current = Math.min(state.current, Math.max(0, result.sites.length - 1));
  state.selected.clear(); state.groups.clear();
  const valid = new Map(result.sites.map(s => [s.title, new Set(s.photos.map(p => p.code))]));
  for (const s of seleccion || []) {
    if (!valid.has(s.title)) continue;
    state.selected.set(s.title, s.codes.filter(c => valid.get(s.title).has(c)));
    state.groups.set(s.title, s.group || '');
  }
  for (const id of ['review', 'editor', 'delivery']) $(id).hidden = false;
  const c = result.counts;
  $('summary').textContent = `${c.photos} fotos en ZIP · ${c.present}/${c.referenced} códigos presentes · ${c.linked} fotos vinculadas · ${c.extra} adicionales · ${result.sites.length} ubicaciones en el plan`;
  $('extras').textContent = result.extra.join(', ') || 'Ninguno';
  $('extra-label').textContent = 'Fotos adicionales sin referencia en el reporte (' + result.extra.length + ')';
  $('issues').textContent = 'Faltantes: ' + (result.missing.join(', ') || 'ninguno') + '\nConflictos: ' + (result.conflicts.join(', ') || 'ninguno');
  const list = $('unresolved'); list.replaceChildren();
  const unique = new Map(result.unresolved.map(r => [r.key, r]));
  for (const row of unique.values()) {
    const line = node('div', undefined, 'review-row');
    const label = node('div', row.address || '(sin dirección)'); label.append(node('small', [row.provider, row.codes.length + ' fotos'].filter(Boolean).join(' · ')));
    const select = node('select'); select.setAttribute('aria-label', 'Nombre Crudos para ' + row.address);
    const blank = node('option', 'Elegir Nombre Crudos…'); blank.value = ''; select.append(blank);
    for (const site of result.sites) { const o = node('option', site.title); o.value = site.title; select.append(o); }
    const button = node('button', 'Confirmar'); button.type = 'button';
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
        message('Equivalencia guardada para toda la campaña.');
      } catch (e) { message(explain(e), true); button.disabled = false; }
    };
    line.append(label, select, button); list.append(line);
  }
  if (!unique.size) list.append(node('p', 'Todas las direcciones tienen una relación confirmada o exacta.'));
  drawSites(); drawEditor();
  $('export').disabled = !c.linked || !!result.conflicts.length;
  $('export-ppt').disabled = !result.sites.length;
  if (!$('ppt-title').value) $('ppt-title').value = defaultTitle();
}

function drawSites() {
  const target = $('sites'); target.replaceChildren();
  const q = $('site-filter').value.trim().toLowerCase();
  state.result.sites.forEach((site, index) => {
    if (q && !(site.location + ' ' + site.title).toLowerCase().includes(q)) return;
    const button = node('button', site.location || site.title); button.type = 'button';
    const picked = (state.selected.get(site.title) || []).length;
    button.append(node('small', (site.photos.length ? site.photos.length + (site.photos.length === 1 ? ' foto' : ' fotos') : 'Pendiente') + (picked ? ' · ' + picked + (picked === 1 ? ' elegida' : ' elegidas') : '')));
    button.className = index === state.current ? 'active' : '';
    button.onclick = () => { state.current = index; drawSites(); drawEditor(); };
    target.append(button);
  });
}

function drawSlide() {
  const site = state.result.sites[state.current]; if (!site) return;
  $('slide-title').textContent = site.title + (state.groups.get(site.title) ? ' · ' + state.groups.get(site.title) : '');
  $('campaign-title').textContent = $('campaign').value.replaceAll('-', ' ').toUpperCase();
  const grid = $('slide-grid'); grid.replaceChildren();
  const codes = state.selected.get(site.title) || [];
  for (let i = 0; i < Number($('layout').value); i++) {
    const slot = node('div', undefined, 'slot');
    const photo = site.photos.find(p => p.code === codes[i]);
    if (photo) slot.append(picture(photo)); else slot.textContent = 'Pendiente';
    grid.append(slot);
  }
}

function drawEditor() {
  const site = state.result.sites[state.current];
  const grid = $('photos-grid'); grid.replaceChildren();
  if (!site) return;
  $('group').value = state.groups.get(site.title) || '';
  const codes = state.selected.get(site.title) || [];
  for (const photo of site.photos) {
    const card = node('div', undefined, 'photo');
    card.append(picture(photo));
    const label = node('label');
    const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = codes.includes(photo.code);
    checkbox.onchange = () => {
      let picked = state.selected.get(site.title) || [];
      if (checkbox.checked) {
        if (picked.length >= Number($('layout').value)) { checkbox.checked = false; message('Selecciona como máximo el número de espacios de la diapositiva.', true); return; }
        picked = [...picked, photo.code];
      } else picked = picked.filter(c => c !== photo.code);
      state.selected.set(site.title, picked); drawSlide();
    };
    label.append(checkbox, node('span', photo.code));
    card.append(label, node('code', photo.filename), node('small', [photo.version, photo.status].filter(Boolean).join(' · '), 'muted'));
    grid.append(card);
  }
  if (!site.photos.length) grid.append(node('p', 'Pendiente: no hay fotos vinculadas para esta ubicación.'));
  drawSlide();
}

async function saveSelection() {
  const button = $('save'); button.disabled = true;
  try {
    const site = state.result.sites[state.current];
    const codes = state.selected.get(site.title) || [];
    const group = $('group').value.trim();
    const validCodes = new Set(site.photos.map(p => p.code));
    if (codes.length > 4 || new Set(codes).size !== codes.length) throw Error('Elige hasta cuatro fotos diferentes.');
    if (!codes.every(c => validCodes.has(c))) throw Error('Foto no válida para la ubicación.');
    await backend.updateCampaign(cid(), data => {
      const seleccion = (data.seleccion || []).filter(s => s.title !== site.title);
      if (codes.length || group) seleccion.push({ title: site.title, codes, group });
      return { next: { ...data, seleccion }, value: null };
    });
    state.groups.set(site.title, group);
    drawSites(); drawSlide();
    message('Selección guardada para ' + (site.location || site.title) + '. El equipo la verá al revisar este mismo lote.');
  } catch (e) { message(explain(e), true); }
  finally { button.disabled = false; }
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
    message(`ZIP listo: ${items.length} fotos renombradas.`);
  } catch (e) { message(explain(e), true); }
  finally { button.disabled = false; }
}

const titleKey = id => 'beeyond-ppt-title:' + id;
function defaultTitle() {
  let saved = null;
  try { saved = localStorage.getItem(titleKey(cid())); } catch { /* sin almacenamiento */ }
  return saved || $('campaign').value.replaceAll('-', ' ').toUpperCase();
}

async function exportPpt() {
  const button = $('export-ppt'); button.disabled = true;
  try {
    const title = $('ppt-title').value.trim() || defaultTitle();
    try { localStorage.setItem(titleKey(cid()), title); } catch { /* sin almacenamiento */ }
    message('Armando PPT…');
    const out = await buildPpt({
      title, fileName: title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-') + '.pptx',
      sites: state.result.sites, selected: state.selected,
      perSlide: Number($('layout').value), zip: state.zip, entryByName: state.entryByName,
      onProgress: (n, total) => message(`Armando PPT… ${n} de ${total} ubicaciones`),
    });
    message(`PPT listo: ${out.slides} diapositivas (${out.withPhotos} con fotos, ${out.pending} pendientes).`);
  } catch (e) { console.error(e); message(explain(e), true); }
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
      const pill = node('span', u.activo ? 'Activo' : 'Baja', 'pill ' + (u.activo ? 'on' : 'off'));
      const toggle = node('button', u.activo ? 'Dar de baja' : 'Reactivar', 'secondary'); toggle.type = 'button'; toggle.disabled = locked;
      toggle.onclick = () => updateUser(u.email, { rol: u.rol, activo: !u.activo });
      const tdRol = node('td'); tdRol.append(rol);
      const tdPill = node('td'); tdPill.append(pill);
      const tdBtn = node('td'); tdBtn.append(toggle);
      tr.append(node('td', u.email + (locked ? ' (principal)' : '')), tdRol, tdPill, tdBtn);
      body.append(tr);
    }
  } catch (e) { $('admin-msg').textContent = explain(e); }
}
async function updateUser(email, data, isNew = false) {
  try { await backend.saveUser(email, data, isNew); $('admin-msg').textContent = 'Guardado: ' + email; }
  catch (e) { $('admin-msg').textContent = explain(e); }
  drawUsers();
}

// ---------------------------------------------------------------- arranque
async function onUser(user) {
  state.user = user;
  if (!user) { show('login'); return; }
  $('who-email').textContent = user.email;
  if (!user.email.endsWith('@' + DOMINIO) || !user.verified) {
    $('denied-msg').textContent = `La cuenta ${user.email} no es una cuenta verificada de @${DOMINIO}. Entra con tu correo de la empresa.`;
    show('denied'); return;
  }
  try { state.access = await backend.getAccess(); }
  catch (e) { $('denied-msg').textContent = explain(e); show('denied'); return; }
  if (!state.access?.activo) {
    $('denied-msg').textContent = `Tu cuenta ${user.email} no tiene alta activa. Pide a ${ADMIN_PRINCIPAL} que te dé de alta en Usuarios.`;
    show('denied'); return;
  }
  $('btn-admin').hidden = state.access.rol !== 'admin';
  show('app');
  refreshCampaigns();
}

async function start() {
  try { backend = await import(DEMO ? './backend-demo.js' : './backend-firebase.js'); }
  catch (e) {
    console.error(e);
    $('screen-loading').textContent = 'No se pudo cargar Firebase. Revisa tu conexión a internet o si la red de la oficina bloquea www.gstatic.com.';
    return;
  }
  $('demo-banner').hidden = !DEMO;
  $('btn-login').onclick = async () => {
    $('login-msg').textContent = '';
    try { await backend.signIn(); }
    catch (e) {
      const msgs = {
        'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permite ventanas emergentes para este sitio.',
        'auth/popup-closed-by-user': 'Se cerró la ventana de Google antes de terminar.',
        'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase (Authentication › Configuración › Dominios autorizados).',
        'auth/operation-not-allowed': 'El acceso con Google no está habilitado en Firebase (Authentication › Método de acceso).',
      };
      $('login-msg').textContent = msgs[e.code] || explain(e);
    }
  };
  for (const id of ['btn-logout', 'btn-logout-2']) $(id).onclick = () => backend.logOut();
  $('btn-admin').onclick = () => { show('admin'); drawUsers(); };
  $('btn-back').onclick = () => show('app');
  $('btn-add-user').onclick = () => {
    const email = $('new-email').value.trim().toLowerCase();
    if (!new RegExp('^[a-z0-9._%+-]+@' + DOMINIO.replace('.', '\\.') + '$').test(email)) { $('admin-msg').textContent = `Escribe un correo @${DOMINIO}.`; return; }
    $('new-email').value = '';
    updateUser(email, { rol: $('new-rol').value, activo: true }, true);
  };
  $('load').onclick = load;
  $('save').onclick = saveSelection;
  $('export').onclick = exportZip;
  $('export-ppt').onclick = exportPpt;
  $('site-filter').oninput = () => state.result && drawSites();
  $('layout').onchange = () => {
    if (!state.result) return;
    const site = state.result.sites[state.current];
    state.selected.set(site.title, (state.selected.get(site.title) || []).slice(0, Number($('layout').value)));
    drawEditor();
  };
  $('campaign').oninput = () => {
    state.result = null; state.selected.clear(); $('ppt-title').value = '';
    for (const id of ['review', 'editor', 'delivery']) $(id).hidden = true;
    message('Elige los archivos (o vuelve a presionar Revisar para usar los mismos) para esta campaña.');
  };
  backend.init(onUser);
}

start();
