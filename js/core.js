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
export function reconcile(report, plan, archives, mappings = {}, ledgerIn = {}) {
  const sites = [];
  const byTitle = new Map();
  for (const row of plan) {
    const title = String(row.NOMBRECRUDOS ?? '').trim();
    if (!title) continue;
    if (byTitle.has(title)) throw new Error('Nombre Crudos repetido en el plan: ' + title);
    const format = row.FORMATO ?? row.TIPODEMEDIO ?? row.TIPODESOPORTE ?? row.TIPO ?? row.MEDIO ?? '';
    const site = { title, location: row.UBICACION ?? '', provider: row.MEDIAOWNER ?? '', city: row.CIUDAD ?? '', format, photos: [] };
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
    const candidates = sites.filter(s => norm(s.location) === norm(address) && norm(s.provider) === norm(provider) && norm(s.city) === norm(row.CIUDAD ?? ''));
    const title = mapped ? mapped : candidates.length === 1 ? candidates[0].title : null;
    const codes = splitCodes(row.FOTOCODIGOS);
    for (const code of codes) if (!archives.has(code)) missing.push(code);
    if (!byTitle.has(title)) {
      unresolved.push({ key, address, provider, version: row.CAMPANA ?? '', codes });
      continue;
    }
    const site = byTitle.get(title);
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
