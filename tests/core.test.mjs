// Pruebas de la lógica (mismos casos que test_core.py). Ejecutar: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, indexArchive, safeName, records, exportList, norm, ledgerToList, ledgerFromList } from '../js/core.js';
import { openZip, readEntry, buildZip } from '../js/zip.js';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TITLE = '1. CDMX_CENTRO COMERCIAL_Puente Digital Doble-Mítikah';
const PLAN = [{ UBICACION: 'PUENTE DIGITAL-MITIKAH', NOMBRECRUDOS: TITLE, MEDIAOWNER: 'DIAFI', CIUDAD: 'CDMX' }];
const ARCHIVES = () => indexArchive(['originales/', ...['A1', 'A2', 'A3', 'EXTRA'].map(c => 'originales/' + c + '.JPG')]);
const run = (codes, address = 'PUENTE DIGITAL-MITIKAH', ledger, mappings) =>
  reconcile([{ DIRECCION: address, FOTOCODIGOS: codes, PROVEEDOR: 'DIAFI', CIUDAD: 'CDMX' }], PLAN, ARCHIVES(), mappings || {}, ledger);

test('vincula por coincidencia exacta y conserva el prefijo', () => {
  const r = run('A1,A2');
  assert.equal(r.counts.linked, 2);
  assert.equal(r.sites[0].photos[0].filename, TITLE + '_01.jpg');
  assert.deepEqual(r.extra, ['A3', 'EXTRA']);
});
test('un lote nuevo conserva nombres y continúa la numeración', () => {
  const first = run('A1,A2');
  const second = run('A2,A3', undefined, first.ledger);
  assert.deepEqual(second.sites[0].photos.map(p => p.filename), [TITLE + '_02.jpg', TITLE + '_03.jpg']);
});
test('la numeración sobrevive el viaje a Firestore', () => {
  const first = run('A1,A2');
  const back = ledgerFromList(JSON.parse(JSON.stringify(ledgerToList(first.ledger))));
  assert.deepEqual(back, first.ledger);
});
test('no adivina direcciones desconocidas', () => {
  const r = run('A1', 'MITIKAH OTRO SOPORTE');
  assert.equal(r.counts.linked, 0); assert.equal(r.unresolved.length, 1);
});
test('aplica equivalencias confirmadas', () => {
  assert.equal(run('A1', 'OTRO', undefined, { 'DIAFI|OTRO': TITLE }).counts.linked, 1);
});
test('faltantes y nombres seguros', () => {
  assert.deepEqual(run('A1,NOTPRESENT').missing, ['NOTPRESENT']);
  assert.ok(!safeName('72. CDMX_METROBUS_MP1902S// Sonora').includes('/'));
});
test('bloquea códigos duplicados en el ZIP', () => {
  assert.throws(() => indexArchive(['a/A1.jpg', 'b/A1.JPG']));
});
test('ignora metadatos de macOS', () => {
  assert.equal(indexArchive(['A1.jpg', '__MACOSX/._A1.jpg', 'x/._A2.jpg']).size, 1);
});
test('records encuentra la fila de encabezados', () => {
  const rows = [{ A: 'Reporte' }, { A: 'Dirección', B: 'Foto Códigos' }, { A: 'Calle 1', B: 'X1, X2' }];
  assert.deepEqual(records(rows, ['DIRECCION', 'FOTOCODIGOS']), [{ DIRECCION: 'Calle 1', FOTOCODIGOS: 'X1, X2' }]);
  assert.throws(() => records(rows, ['UBICACION']));
  assert.equal(norm('Ubicación'), 'UBICACION');
});

test('ZIP: lee entradas comprimidas y exporta con bytes idénticos', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bt-'));
  const src = join(dir, 'src.zip');
  execFileSync('python3', ['-I', '-c', `
import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('originales/A1.JPG', b'original-image-bytes'*50)
    z.writestr('originales/A2.png', b'png-bytes')
    z.writestr('ñandú/A3.jpg', b'x', compress_type=zipfile.ZIP_STORED)
`, src]);
  const zip = await openZip(new Blob([readFileSync(src)]));
  const names = zip.entries.map(e => e.name);
  assert.ok(names.includes('ñandú/A3.jpg'));
  const a1 = zip.entries.find(e => e.name.endsWith('A1.JPG'));
  assert.equal(await (await readEntry(zip, a1)).text(), 'original-image-bytes'.repeat(50));
  const r = reconcile([{ DIRECCION: 'PUENTE DIGITAL-MITIKAH', FOTOCODIGOS: 'A1,A2', PROVEEDOR: 'DIAFI', CIUDAD: 'CDMX' }], PLAN, indexArchive(names));
  const byName = new Map(zip.entries.map(e => [e.name, e]));
  const items = exportList(r).map(x => ({ name: x.filename, zip, entry: byName.get(x.member) }));
  const out = join(dir, 'out.zip');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, Buffer.from(await (await buildZip(items)).arrayBuffer()));
  const check = execFileSync('python3', ['-I', '-c', `
import zipfile,sys,json
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print(json.dumps({n: z.read(n).decode() for n in z.namelist()}))`, out]).toString();
  const files = JSON.parse(check);
  // PNG se mantiene PNG; JPG se normaliza a .jpg
  assert.deepEqual(Object.keys(files), [TITLE + '_01.jpg', TITLE + '_02.png']);
  assert.equal(files[TITLE + '_02.png'], 'png-bytes');
  assert.equal(files[TITLE + '_01.jpg'], 'original-image-bytes'.repeat(50));
});

import { classifyComment, siteStatus } from '../js/core.js';
test('clasifica los comentarios del reporte de monitoreo', () => {
  assert.equal(classifyComment('sin problemas'), null);
  assert.equal(classifyComment('arte no colocado'), 'Con observaciones');
  assert.equal(classifyComment('esta version no se exhibio'), 'Con observaciones');
  assert.equal(classifyComment('Esta versión NO se exhibió'), 'Con observaciones');
  assert.equal(classifyComment('la pantalla tiene algunos leds dañados'), 'En revisión');
  assert.equal(classifyComment('No enciende la pantalla'), 'En revisión');
  assert.equal(classifyComment('La pantalla no enciende correctamente'), 'En revisión');
  assert.equal(classifyComment('vidrio roto'), 'En revisión');
  assert.equal(classifyComment('en vista natural arte no colocado y en vista cruzada no enciende la pantalla'), 'Con observaciones');
});
test('estatus por ubicación', () => {
  const p = [{ code: 'A1' }];
  assert.deepEqual(siteStatus({ photos: [], notes: [] }), { estatus: 'Pendiente', comentario: 'Sin registro fotográfico' });
  assert.equal(siteStatus({ photos: p, notes: [{ version: 'V1', text: 'sin problemas' }] }), null);
  assert.deepEqual(siteStatus({ photos: p, notes: [{ version: '24 MSI', text: 'sin problemas' }, { version: 'PROMOS', text: 'arte no colocado' }] }),
    { estatus: 'Con observaciones', comentario: 'PROMOS: arte no colocado' });
  assert.deepEqual(siteStatus({ photos: p, notes: [{ version: 'V', text: 'No enciende la pantalla' }, { version: 'V', text: 'no enciende la pantalla' }] }),
    { estatus: 'En revisión', comentario: 'No enciende la pantalla' });
  assert.deepEqual(siteStatus({ photos: p, notes: [{ version: '24 MSI', text: 'leds dañados' }, { version: 'PROMOS', text: 'leds dañados' }] }),
    { estatus: 'En revisión', comentario: 'leds dañados' });
});

import { exactCandidates, suggest } from '../js/core.js';
test('empareja aunque el proveedor esté escrito distinto', () => {
  const plan = [{ UBICACION: 'AV. VALLARTA #5366, ZAPOPAN, ', NOMBRECRUDOS: '3. GDL_X_Vallarta', MEDIAOWNER: 'Grupo Pol Devices ', CIUDAD: 'GDL' }];
  const r = reconcile([{ DIRECCION: 'AV. VALLARTA #5366, ZAPOPAN', FOTOCODIGOS: 'A1', PROVEEDOR: 'GPO POL', CIUDAD: 'GDL' }], plan, ARCHIVES());
  assert.equal(r.counts.linked, 1); assert.equal(r.unresolved.length, 0);
});
test('misma dirección en dos ubicaciones: desempata el proveedor', () => {
  const sites = [{ title: 'a', location: 'CEDROS', provider: 'West Media Devices', city: 'GDL' }, { title: 'b', location: 'CEDROS', provider: 'Grupo Pol Devices', city: 'GDL' }];
  assert.deepEqual(exactCandidates(sites, 'Cedros', 'WEST MEDIA', 'GDL').map(s => s.title), ['a']);
  assert.equal(exactCandidates(sites, 'Cedros', 'OTRO', 'GDL').length, 2);   // ambiguo: no adivina
});
test('sugiere la ubicación más parecida', () => {
  const sites = [{ title: 'x', location: 'GLORIETA DE LA MINERVA II (LANDMARK)', provider: 'West Media Devices', city: 'GDL' },
    { title: 'y', location: 'MINERVA (LANDMARK - VISTA NATURAL)', provider: 'West Media Devices', city: 'GDL' },
    { title: 'z', location: 'AUTOPISTA AEROPUERTO NO. 3167', provider: 'West Media Devices', city: 'GDL' }];
  assert.equal(suggest(sites, { address: 'MINERVA LANDMARK VISTA NATURAL', provider: 'WEST MEDIA', city: 'GDL' })[0].site.title, 'y');
  assert.equal(suggest(sites, { address: 'AUT. AEROPUERTO 3167', provider: 'WEST MEDIA', city: 'GDL' })[0].site.title, 'z');
});

test('plan con Dirección/Proveedor, sin Ciudad, y renglones SITIO DE BACK', () => {
  const rows = [{ A: '# SLIDE', B: 'PROVEEDOR', C: 'Formato', D: 'Dirección', E: 'Nombre Crudos' },
    { A: '1', B: 'VIA VERDE', C: 'Columna', D: 'Blvd. Adolfo López Mateos 2948', E: '1. CDMX_Columna _Blvd. Adolfo López Mateos 2948' },
    { A: '', B: 'VIA VERDE', C: 'Columna', D: 'Otra', E: 'SITIO DE BACK' },
    { A: '', B: 'VIA VERDE', C: 'Columna', D: 'Otra 2', E: 'SITIO DE BACK ' }];
  const plan = records(rows, ['UBICACION|DIRECCION', 'NOMBRECRUDOS']);
  const r = reconcile([{ DIRECCION: 'BLVD. ADOLFO LOPEZ MATEOS 2948', FOTOCODIGOS: 'A1', PROVEEDOR: 'VIA VERDE' }], plan, ARCHIVES());
  assert.equal(r.sites.length, 1); assert.equal(r.skipped.length, 2);
  assert.deepEqual([r.sites[0].location, r.sites[0].provider, r.sites[0].city, r.sites[0].format], ['Blvd. Adolfo López Mateos 2948', 'VIA VERDE', 'CDMX', 'Columna']);
  assert.equal(r.counts.linked, 1);
  assert.throws(() => records(rows, ['UBICACION', 'NOMBRECRUDOS']), /UBICACION/);
});
