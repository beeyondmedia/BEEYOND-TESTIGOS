// Lectura mínima de XLSX en el navegador: devuelve todas las hojas [{ name, hidden, rows() }].
import { openZip, readEntry } from './zip.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function xml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('El Excel tiene un XML dañado.');
  return doc;
}

const children = (el, name) => Array.from(el.children).filter(c => c.localName === name);

function colToIndex(col) { let n = 0; for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function indexToCol(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

export async function readXlsx(file) {
  let zip;
  try { zip = await openZip(file); } catch { throw new Error(`"${file.name}" no es un archivo .xlsx válido.`); }
  const byName = new Map(zip.entries.map(e => [e.name, e]));
  const text = async name => { const e = byName.get(name); return e ? (await readEntry(zip, e)).text() : null; };

  const strings = [];
  const sst = await text('xl/sharedStrings.xml');
  if (sst) {
    for (const si of xml(sst).getElementsByTagNameNS(NS, 'si')) {
      // Concatena los textos, excluyendo la guía fonética (rPh).
      let s = '';
      for (const t of si.getElementsByTagNameNS(NS, 't')) if (t.parentElement.localName !== 'rPh') s += t.textContent;
      strings.push(s);
    }
  }
  const workbook = xml(await text('xl/workbook.xml') || '');
  const sheetEls = Array.from(workbook.getElementsByTagNameNS(NS, 'sheet'));
  if (!sheetEls.length) throw new Error(`"${file.name}" no tiene hojas.`);
  const rels = xml(await text('xl/_rels/workbook.xml.rels') || '');
  const relEls = Array.from(rels.getElementsByTagName('Relationship'));
  const sheets = [];
  for (const el of sheetEls) {
    const rel = relEls.find(r => r.getAttribute('Id') === el.getAttributeNS(NS_REL, 'id'));
    if (!rel) continue;
    let target = rel.getAttribute('Target');
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    const name = el.getAttribute('name') || target;
    const hidden = ['hidden', 'veryHidden'].includes(el.getAttribute('state'));
    // Cada hoja se lee solo cuando se pide (rows()).
    sheets.push({ name, hidden, rows: async () => {
      const sheetText = await text(target);
      if (!sheetText) return [];
      const sheet = xml(sheetText);
      const result = [];
      for (const row of sheet.getElementsByTagNameNS(NS, 'row')) {
        const values = {};
        let col = 0;
        for (const cell of children(row, 'c')) {
          const ref = cell.getAttribute('r');
          const letters = ref ? ref.replace(/[0-9]/g, '') : indexToCol(col + 1);
          col = colToIndex(letters);
          const v = children(cell, 'v')[0];
          const inline = children(cell, 'is')[0];
          let value = v ? v.textContent : inline ? inline.textContent : '';
          if (cell.getAttribute('t') === 's' && value) value = strings[parseInt(value, 10)] ?? '';
          if (value) values[letters] = value;
        }
        if (Object.keys(values).length) result.push(values);
      }
      return result;
    } });
  }
  return sheets;
}
