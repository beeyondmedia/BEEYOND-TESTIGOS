// Lectura y escritura de ZIP en el navegador, sin dependencias.
// - Lee solo el directorio central (no carga el ZIP completo en memoria).
// - Extrae entradas con DecompressionStream (nativo del navegador).
// - Al exportar copia los bytes comprimidos originales: no se recomprime ninguna foto.

const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeName(bytes, flags) {
  if (flags & 0x800) return new TextDecoder('utf-8').decode(bytes);
  let out = '';
  for (const b of bytes) out += b < 128 ? String.fromCharCode(b) : CP437[b - 128];
  return out;
}

const MAX32 = 0xffffffff;

export async function openZip(blob) {
  const size = blob.size;
  if (size < 22) throw new Error('El archivo no es un ZIP válido.');
  const tailLen = Math.min(size, 65557);
  const tailStart = size - tailLen;
  const tail = new DataView(await blob.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo no es un ZIP válido.');
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === MAX32 || cdOffset === MAX32) {
    const loc = eocd - 20;
    if (loc < 0 || tail.getUint32(loc, true) !== 0x07064b50) throw new Error('ZIP64 no reconocido.');
    const z64 = Number(tail.getBigUint64(loc + 8, true));
    const z = new DataView(await blob.slice(z64, z64 + 56).arrayBuffer());
    if (z.getUint32(0, true) !== 0x06064b50) throw new Error('ZIP64 no reconocido.');
    count = Number(z.getBigUint64(32, true));
    cdSize = Number(z.getBigUint64(40, true));
    cdOffset = Number(z.getBigUint64(48, true));
  }
  const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const entries = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) throw new Error('Directorio del ZIP dañado.');
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    const dosTime = cd.getUint16(p + 12, true);
    const dosDate = cd.getUint16(p + 14, true);
    const crc = cd.getUint32(p + 16, true);
    let csize = cd.getUint32(p + 20, true);
    let usize = cd.getUint32(p + 24, true);
    const nlen = cd.getUint16(p + 28, true);
    const elen = cd.getUint16(p + 30, true);
    const clen = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    const name = decodeName(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen), flags);
    let e = p + 46 + nlen;
    const eEnd = e + elen;
    while (e + 4 <= eEnd) {
      const id = cd.getUint16(e, true), sz = cd.getUint16(e + 2, true);
      if (id === 1) {
        let q = e + 4;
        if (usize === MAX32) { usize = Number(cd.getBigUint64(q, true)); q += 8; }
        if (csize === MAX32) { csize = Number(cd.getBigUint64(q, true)); q += 8; }
        if (offset === MAX32) { offset = Number(cd.getBigUint64(q, true)); q += 8; }
      }
      e += 4 + sz;
    }
    entries.push({ name, flags, method, dosTime, dosDate, crc, csize, usize, offset, dir: name.endsWith('/') });
    p += 46 + nlen + elen + clen;
  }
  return { blob, entries };
}

async function dataStart(zip, entry) {
  if (entry._start !== undefined) return entry._start;
  const h = new DataView(await zip.blob.slice(entry.offset, entry.offset + 30).arrayBuffer());
  if (h.getUint32(0, true) !== 0x04034b50) throw new Error('Entrada del ZIP dañada: ' + entry.name);
  entry._start = entry.offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  return entry._start;
}

export async function readEntry(zip, entry, type = '') {
  if (entry.flags & 1) throw new Error('El ZIP está protegido con contraseña: ' + entry.name);
  const start = await dataStart(zip, entry);
  const raw = zip.blob.slice(start, start + entry.csize);
  if (entry.method === 0) return new Blob([raw], { type });
  if (entry.method === 8) {
    const out = await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    return type ? new Blob([out], { type }) : out;
  }
  throw new Error('Método de compresión no soportado en ' + entry.name);
}

let CRC_TABLE;
export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Entrada nueva (sin comprimir) para buildZip: { name, data: Uint8Array | string }.
export function newEntry(name, data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const entry = { name, flags: 0, method: 0, dosTime, dosDate, crc: crc32(bytes), csize: bytes.length, usize: bytes.length, _start: 0 };
  return { name, zip: { blob: new Blob([bytes]) }, entry };
}

// items: [{ name, zip, entry }]. Devuelve un Blob que referencia los bytes originales.
export async function buildZip(items) {
  if (items.length > 0xfffe) throw new Error('Demasiados archivos para un ZIP (máx. 65,534).');
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const { name, zip, entry } of items) {
    if (entry.flags & 1) throw new Error('El ZIP está protegido con contraseña: ' + entry.name);
    const start = await dataStart(zip, entry);
    const nameBytes = enc.encode(name);
    const flags = 0x800 | (entry.flags & 0x6);
    if (offset > MAX32 || entry.csize >= MAX32 || entry.usize >= MAX32) {
      throw new Error('El ZIP resultante supera 4 GB. Divide el lote en partes más pequeñas.');
    }
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, flags, true);
    lh.setUint16(8, entry.method, true); lh.setUint16(10, entry.dosTime, true); lh.setUint16(12, entry.dosDate, true);
    lh.setUint32(14, entry.crc, true); lh.setUint32(18, entry.csize, true); lh.setUint32(22, entry.usize, true);
    lh.setUint16(26, nameBytes.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, nameBytes, zip.blob.slice(start, start + entry.csize));
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, flags, true);
    ch.setUint16(10, entry.method, true); ch.setUint16(12, entry.dosTime, true); ch.setUint16(14, entry.dosDate, true);
    ch.setUint32(16, entry.crc, true); ch.setUint32(20, entry.csize, true); ch.setUint32(24, entry.usize, true);
    ch.setUint16(28, nameBytes.length, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, nameBytes);
    offset += 30 + nameBytes.length + entry.csize;
  }
  const cdSize = central.reduce((s, b) => s + b.byteLength, 0);
  if (offset + cdSize > MAX32) throw new Error('El ZIP resultante supera 4 GB. Divide el lote en partes más pequeñas.');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, items.length, true); end.setUint16(10, items.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
