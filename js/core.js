// Conciliación de evidencias. Port directo de core.py (versión local de revisión).
// Funciones puras: no tocan red, Firebase ni DOM, para poder probarlas con `node --test`.

export function norm(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

// Busca la fila de encabezados que contiene las columnas requeridas y devuelve las filas siguientes
// con llaves normalizadas (p. ej. "Nombre Crudos" -> "NOMBRECRUDOS").
export function records(rows, required, label = 'el archivo') {
  for (let i = 0; i < rows.length; i++) {
    const headers = {};
    for (const [col, value] of Object.entries(rows[i])) headers[col] = norm(value);
    const found = new Set(Object.values(headers));
    if (required.every(r => found.has(r))) {
      return rows.slice(i + 1).map(row => {
        const out = {};
        for (const [col, value] of Object.entries(row)) if (col in headers) out[headers[col]] = value;
        return out;
      });
    }
  }
  throw new Error(`No se encontraron las columnas requeridas en ${label}: ` + required.join(', '));
}

// sheets: [{ name, hidden, rows: () => Promise<filas> }]. Busca la hoja que tenga las columnas requeridas,
// primero entre las visibles. Así funciona aunque los datos no estén en la primera hoja.
export async function recordsFromSheets(sheets, required, label = 'el archivo') {
  const ordered = [...sheets.filter(s => !s.hidden), ...sheets.filter(s => s.hidden)];
  for (const sheet of ordered) {
    try { return { sheet: sheet.name, rows: records(await sheet.rows(), required, label) }; }
    catch (e) { if (!/columnas requeridas/.test(e.message)) throw e; }
  }
  throw new Error(`No se encontraron las columnas ${required.join(' y ')} en ninguna hoja de ${label} (hojas: ${sheets.map(s => s.name).join(', ')}).`);
}

export function safeName(value) {
  // Restricciones de Windows y de rutas ZIP. El título original completo se conserva aparte.
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[ .]+$/, '').slice(0, 200);
}

const EXT = /\.(jpe?g|png)$/i;

export function basename(path) { return path.split('/').pop(); }
export function stem(path) { const b = basename(path); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; }
export function suffix(path) { const b = basename(path); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i).toLowerCase() : ''; }

// names: lista de rutas dentro del ZIP. Devuelve Map CÓDIGO -> ruta.
export function indexArchive(names) {
  const archives = new Map();
  const duplicates = [];
  for (const name of names) {
    if (name.endsWith('/') || !EXT.test(name)) continue;
    // Ignora los metadatos que agrega macOS al comprimir.
    if (name.startsWith('__MACOSX/') || basename(name).startsWith('._')) continue;
    const code = stem(name).toUpperCase();
    if (archives.has(code)) duplicates.push(code);
    archives.set(code, name);
  }
  if (duplicates.length) throw new Error('Códigos de foto duplicados en el ZIP: ' + duplicates.slice(0, 10).join(', '));
  return archives;
}

const splitCodes = s => String(s ?? '').split(',').map(c => c.trim().toUpperCase()).filter(Boolean);

// report/plan: filas ya normalizadas por records(). archives: Map código -> ruta.
// mappings: { 'PROVEEDOR|DIRECCION': 'Nombre Crudos' }. ledger: { 'título\tcódigo': {number, filename} }
// Proveedores escritos distinto en reporte y plan ("GPO POL" / "Grupo Pol Devices"):
// se comparan por palabras significativas.
const GENERIC = new Set(['GRUPO', 'GPO', 'DEVICES', 'DEVICE', 'MEDIA', 'SA', 'DE', 'CV', 'S', 'C', 'V', 'THE', 'OOH', 'DOOH', 'DIGITAL', 'PUBLICIDAD', 'EXTERIOR']);
const words = v => String(v ?? '').normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
const providerWords = v => new Set(words(v).filter(w => !GENERIC.has(w)));
function sameProvider(a, b) {
  if (norm(a) === norm(b)) return true;
  const A = providerWords(a), B = providerWords(b);
  return [...A].some(w => B.has(w));
}

// Coincidencia exacta de la dirección (normalizada). Si hay varias ubicaciones con la misma
// dirección, desempatan la ciudad y el proveedor. Nunca se adivina con direcciones distintas.
export function exactCandidates(sites, address, provider, city) {
  let c = sites.filter(s => norm(s.location) === norm(address));
  if (c.length > 1) { const byCity = c.filter(s => norm(s.city) === norm(city ?? '')); if (byCity.length) c = byCity; }
  if (c.length > 1) { const exact = c.filter(s => norm(s.provider) === norm(provider)); if (exact.length) c = exact; }
  if (c.length > 1) { const similar = c.filter(s => sameProvider(s.provider, provider)); if (similar.length) c = similar; }
  return c;
}

// Ubicaciones del plan más parecidas a una dirección del reporte (para sugerir, no para asignar).
export function suggest(sites, row, limit = 5) {
  const target = new Set(words(row.address));
  if (!target.size) return [];
  return sites.map(site => {
    const w = new Set(words(site.location));
    const inter = [...target].filter(x => w.has(x)).length;
    let score = inter / (new Set([...target, ...w]).size || 1);
    if (norm(site.city) && norm(site.city) === norm(row.city)) score += 0.1;
    if (sameProvider(site.provider, row.provider)) score += 0.15;
    // Los números de la dirección (calle, #) pesan más.
    if ([...target].some(x => /\d/.test(x) && w.has(x))) score += 0.2;
    return { site, score };
  }).filter(x => x.score >= 0.3).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function reconcile(report, plan, archives, mappings = {}, ledgerIn = {}) {
  const sites = [];
  const byTitle = new Map();
  for (const row of plan) {
    const title = String(row.NOMBRECRUDOS ?? '').trim();
    if (!title) continue;
    if (byTitle.has(title)) throw new Error('Nombre Crudos repetido en el plan: ' + title);
    const format = row.VENUETYPE || row.TIPODEMEDIO || row.TIPODESOPORTE || row.TIPODEUBICACION || row.FORMATO || row.TIPO || '';
    const site = { title, location: row.UBICACION ?? '', provider: row.MEDIAOWNER ?? '', city: row.CIUDAD ?? '', format, photos: [], notes: [] };
    sites.push(site); byTitle.set(title, site);
  }
  const ledger = { ...ledgerIn };
  const nextNumbers = new Map();
  for (const [key, value] of Object.entries(ledger)) {
    const title = key.split('\t')[0];
    nextNumbers.set(title, Math.max(nextNumbers.get(title) ?? 0, value.number));
  }
  const used = new Set(), missing = [], unresolved = [], conflicts = [];
  const owners = new Map();
  for (const row of report) {
    const address = row.DIRECCION ?? '';
    const provider = row.PROVEEDOR ?? '';
    const key = norm(provider) + '|' + norm(address);
    const mapped = mappings[key];
    // Coincidencia exacta normalizada de ubicación + proveedor + ciudad; nunca se adivina.
    const candidates = exactCandidates(sites, address, provider, row.CIUDAD);
    const title = mapped ? mapped : candidates.length === 1 ? candidates[0].title : null;
    const codes = splitCodes(row.FOTOCODIGOS);
    for (const code of codes) if (!archives.has(code)) missing.push(code);
    if (!byTitle.has(title)) {
      unresolved.push({ key, address, provider, city: row.CIUDAD ?? '', version: row.CAMPANA ?? '', codes });
      continue;
    }
    const site = byTitle.get(title);
    site.notes.push({ version: String(row.CAMPANA ?? '').trim(), text: String(row.ESTATUS ?? '').trim() });
    for (const code of codes) {
      if (!archives.has(code)) continue;
      if (owners.has(code) && owners.get(code) !== title) { conflicts.push(code); continue; }
      owners.set(code, title);
      used.add(code);
      if (site.photos.some(p => p.code === code)) continue;
      const ledgerKey = title + '\t' + code;
      if (!(ledgerKey in ledger)) {
        const number = (nextNumbers.get(title) ?? 0) + 1;
        nextNumbers.set(title, number);
        const filename = safeName(title) + '_' + String(number).padStart(2, '0') + suffix(archives.get(code));
        const existing = new Set(Object.values(ledger).map(v => v.filename.toLowerCase()));
        if (existing.has(filename.toLowerCase())) throw new Error('Colisión de nombres: ' + filename);
        ledger[ledgerKey] = { number, filename };
      }
      site.photos.push({ code, member: archives.get(code), filename: ledger[ledgerKey].filename, version: row.CAMPANA ?? '', status: row.ESTATUS ?? '' });
    }
  }
  const referenced = new Set(report.flatMap(r => splitCodes(r.FOTOCODIGOS)));
  const archiveCodes = [...archives.keys()];
  const extra = archiveCodes.filter(c => !referenced.has(c)).sort();
  return {
    sites, unresolved,
    missing: [...new Set(missing)].sort(),
    extra,
    conflicts: [...new Set(conflicts)].sort(),
    ledger,
    counts: {
      photos: archives.size,
      referenced: referenced.size,
      present: [...referenced].filter(c => archives.has(c)).length,
      linked: used.size,
      extra: extra.length,
    },
  };
}

export function exportList(result) {
  if (result.conflicts.length) throw new Error('Hay códigos vinculados a más de una ubicación.');
  const photos = result.sites.flatMap(s => s.photos);
  if (!photos.length) throw new Error('No hay fotos vinculadas para exportar.');
  return photos.map(p => ({ member: p.member, filename: p.filename }));
}

// Conversión entre la forma en memoria y la forma guardada en Firestore (arreglos).
export const ledgerToList = ledger => Object.entries(ledger).map(([k, v]) => {
  const [title, code] = k.split('\t');
  return { title, code, number: v.number, filename: v.filename };
});
export const ledgerFromList = list => Object.fromEntries((list || []).map(x => [x.title + '\t' + x.code, { number: x.number, filename: x.filename }]));
export const mappingsFromList = list => Object.fromEntries((list || []).map(x => [x.key, x.title]));

// ---------------------------------------------------------------- estatus del reporte (columna Estatus)
// Se usa para el recuadro de la diapositiva que luego lee la app de Comprobación.
const fold = t => String(t ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const SIN_PROBLEMA = /^(sin problemas?|sin observaciones|sin comentarios?|ok|correct[oa]|aprobad[oa]|exhibid[oa]|bien|-|n\/?a)$/;
const OBSERVACION = /arte\s*no\s*colocad|no\s*se\s*exhib|no\s*exhibid|version\s*no/;

// "arte no colocado" -> Con observaciones · "leds dañados", "no enciende"… -> En revisión.
// Cualquier otro comentario -> En revisión (para que alguien lo revise). "sin problemas" -> null.
export function classifyComment(text) {
  const t = fold(text);
  if (!t || SIN_PROBLEMA.test(t)) return null;
  return OBSERVACION.test(t) ? 'Con observaciones' : 'En revisión';
}

// Estatus de la ubicación para la diapositiva: { estatus, comentario } o null si no lleva recuadro.
// Sin fotos ni comentario -> Pendiente. Con un comentario de observación en cualquiera de sus renglones,
// gana "Con observaciones"; si solo hay de revisión, "En revisión".
export function siteStatus(site) {
  const notes = (site.notes || []).filter(n => classifyComment(n.text));
  if (!notes.length) return site.photos.length ? null : { estatus: 'Pendiente', comentario: 'Sin registro fotográfico' };
  const estatus = notes.some(n => classifyComment(n.text) === 'Con observaciones') ? 'Con observaciones' : 'En revisión';
  // Mismo comentario en todas las versiones -> una vez; si solo aplica a algunas, se dice a cuáles.
  const all = new Set((site.notes || []).map(n => n.version).filter(Boolean));
  const byText = new Map();
  for (const n of notes) {
    const k = fold(n.text);
    if (!byText.has(k)) byText.set(k, { text: n.text, versions: new Set() });
    if (n.version) byText.get(k).versions.add(n.version);
  }
  const parts = [...byText.values()].map(({ text, versions }) =>
    all.size > 1 && versions.size && versions.size < all.size ? [...versions].join(', ') + ': ' + text : text);
  return { estatus, comentario: parts.join(' · ') };
}
