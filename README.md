# Beeyond Testigos — app web (Firebase + GitHub)

App interna para conciliar las fotos de Media Nitro con el plan de campaña, renombrarlas con el **Nombre Crudos** y descargar el ZIP de testigos. Es la evolución de la versión local en Python (`server.py`): misma lógica, ahora como página web para todo el equipo.

- **Las fotos y los Excel no se suben a internet.** Se procesan en el navegador de cada persona. Aguanta ZIP grandes porque solo lee el índice del ZIP y, al exportar, copia los bytes originales sin recomprimir.
- **Firebase (plan gratuito Spark)** guarda por campaña lo que el equipo comparte: equivalencias confirmadas, numeración estable de cada foto y la selección para la diapositiva. También controla quién entra (Google + lista de usuarios).
- **GitHub** guarda el código. Cada cambio en `main` corre las pruebas y se publica solo.
- **Modo demostración:** abre la app con `?demo` al final del link para probar sin Firebase (los datos quedan solo en tu navegador).

## Reglas que conserva de la versión local

- Nombre de archivo = Nombre Crudos completo con su prefijo numérico + `_01`, `_02`… + extensión original en minúsculas (PNG sigue siendo PNG).
- Numeración estable por campaña: el mismo código conserva su nombre en otro lote; uno nuevo continúa la secuencia.
- Solo vincula automáticamente si coinciden ubicación, proveedor y ciudad normalizados, sin ambigüedad. Lo demás se confirma a mano y queda guardado para toda la campaña.
- Bloquea Nombre Crudos repetidos, códigos de foto duplicados en el ZIP, colisiones de nombre y fotos asignadas a dos ubicaciones.
- Caracteres que Windows no admite (`/ \ : * ? " < > |`) se cambian por guion solo en el nombre del archivo.
- Hasta 4 fotos por ubicación para la vista previa de la diapositiva.
- Novedad: volver a revisar **el mismo lote** conserva la selección; un lote diferente la limpia. También ignora los archivos `__MACOSX` que agrega la Mac al comprimir.

## Acceso

Entra quien tenga cuenta de Google **verificada @beeyondmedia.com** y además **alta activa** en la lista de Usuarios. Las reglas de Firestore (`firestore.rules`) lo validan en el servidor, no solo en la pantalla.

- Administrador principal: `eliot.fabela@beeyondmedia.com`. Entra sin alta previa y desde el botón **Usuarios** da de alta, cambia el rol o da de baja a las demás personas. Para cambiarlo, edita `js/config.js` **y** `firestore.rules`.
- Roles: **Usuario** (trabaja campañas) y **Administrador** (además administra usuarios).

## Instalación (una sola vez)

### 1. Firebase (proyecto "Beeyond Testigos", ID `beeyond-testigos-9f3e2`)

1. <https://console.firebase.google.com> → proyecto **Beeyond Testigos** (`beeyond-testigos-9f3e2`).
2. **Compilación › Authentication › Comenzar › Método de acceso › Google › Habilitar.** Elige el correo de asistencia y guarda.
3. **Compilación › Firestore Database › Crear base de datos** → modo **producción**, ubicación `nam5 (us-central)` o la más cercana.
4. **Firestore › Reglas**: borra lo que haya, pega todo el contenido de `firestore.rules` y presiona **Publicar**.
5. Si vas a usar GitHub Pages (paso 3): **Authentication › Configuración › Dominios autorizados › Agregar dominio** → `beeyondmedia.github.io`. (`beeyond-testigos-9f3e2.web.app` y `localhost` ya vienen autorizados.)

### 2. GitHub

1. En la organización `beeyondmedia` crea un repositorio nuevo llamado **`BEEYOND-TESTIGOS`** (vacío, sin README).
2. Sube todos los archivos de esta carpeta (botón **Add file › Upload files**, arrastra el contenido, incluida la carpeta `.github`), o pide a Claude que los suba.

### 3. Publicar la página (elige una)

**Opción A — Firebase Hosting (recomendada): `https://beeyond-testigos-9f3e2.web.app`**

1. Firebase → ⚙️ **Configuración del proyecto › Cuentas de servicio › Generar nueva clave privada**. Se descarga un `.json`. Guárdalo en un lugar seguro y no lo subas al repositorio.
2. En Google Cloud (<https://console.cloud.google.com/iam-admin/iam?project=beeyond-testigos-9f3e2>) asegúrate de que esa cuenta de servicio (`firebase-adminsdk-…`) tenga los roles **Administrador de Firebase Hosting**, **Administrador de reglas de Firebase** y **Usuario de cuentas de servicio**. Si no publica por permisos, agrega temporalmente **Editor**.
3. En GitHub, en el repositorio: **Settings › Secrets and variables › Actions › New repository secret**. Nombre: `FIREBASE_SERVICE_ACCOUNT`. Valor: pega el contenido completo del `.json`.
4. **Actions › Pruebas y publicación › Run workflow** (o haz cualquier cambio en `main`). En 1–2 minutos queda en `https://beeyond-testigos-9f3e2.web.app`. Desde entonces cada cambio se publica solo, incluidas las reglas de Firestore.

**Opción B — GitHub Pages (sin claves): `https://beeyondmedia.github.io/BEEYOND-TESTIGOS/`**

1. En el repositorio: **Settings › Pages › Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`.
2. Agrega `beeyondmedia.github.io` como dominio autorizado (paso 1.5).
3. Con esta opción las reglas de Firestore se actualizan a mano (paso 1.4) cada vez que cambien.

### 4. Primer uso

1. Abre la app y entra con `eliot.fabela@beeyondmedia.com`.
2. **Usuarios** → da de alta los correos del equipo.
3. Cada persona entra con su cuenta de Google de la empresa.

## Uso

1. **Archivos del lote.** Escribe o elige el identificador de campaña (minúsculas, números y guiones; ej. `mercado-pago-buen-fin-2026`) y elige el **plan XLSX**, el **reporte de Media Nitro XLSX** y el **ZIP original de fotos**. Opcional: la **PPT ya hecha** de esa campaña. Presiona **Revisar**.
   - **¿Solo tienes el plan?** En *¿Solo tienes el plan? Genera la PPT con los espacios de fotos vacíos* eliges el título y cuántos espacios por diapositiva (1–4). Sale una diapositiva por ubicación del plan con el diseño de Beeyond y marcadores de imagen de PowerPoint (clic en el ícono para insertar la foto; se ajusta sola). Cada marcador se llama como el archivo esperado (`Nombre Crudos_01`…). Las fotos insertadas así las cuentan esta app (al actualizar) y la de Comprobación.
2. **Confirmar ubicaciones.** Elige el Nombre Crudos de las direcciones que no coincidieron solas. Queda guardado para toda la campaña.
3. **Elegir fotos.** Filtros: *Todas*, *Con fotos*, *Pendientes (sin fotos)*, *Con fotos sin elegir* y, si cargaste una PPT, *Por agregar o completar en PPT*. Elige hasta 4 fotos por ubicación y presiona **Guardar selección**. Si no eliges, se usan las primeras vinculadas.
4. **Entregar.**
   - **Diapositivas incompletas:** si una diapositiva de tu PPT tiene menos fotos que *Fotos por diapositiva* (p. ej. 2 de 4 porque falta una versión), sale como *En PPT 2 de 4 · faltan 2* y en el filtro *Incompletas en PPT*. Elige ahí las fotos que faltan y, al actualizar, se agregan **a la misma diapositiva** junto con las que ya tenía (no se crea otra). Si no eliges, se queda igual: la app no sabe cuáles fotos nuevas ya están en tu PPT.
   - **Actualizar PPT cargada:** conserva la presentación tal cual y solo agrega, en el orden del plan, las ubicaciones que le faltan, y reemplaza las diapositivas que estaban como *Pendiente* (sin fotos) cuando ya hay fotos. Las diapositivas se reconocen por el número del Nombre Crudos (`29. TAMARINDOS` ↔ `29. CDMX_LANDMARK_Tamarindos`). No carga la presentación completa en memoria: copia tal cual todo lo que no cambia.
   - **Acomodo de fotos** (igual en PPT nueva y al actualizar): 1 foto = grande al centro · 2 = una arriba de otra, centradas · 3 = dos arriba y una centrada abajo · 4 = cuadrícula 2 × 2.
   - **Estatus del reporte de monitoreo:** la columna *Estatus* se clasifica por ubicación y va en la diapositiva en un recuadro (nombre `BT-ESTATUS`) que ocupa el lugar de una foto; la app de Comprobación lo lee y guarda el estatus y el comentario.
     - *Con observaciones:* "arte no colocado", "esta versión no se exhibió" (también si viene junto con otro problema).
     - *En revisión:* "leds dañados", "no enciende", y cualquier otro comentario (vidrio roto, zona de obras…).
     - *Pendiente:* sin fotos ni comentario. "sin problemas" no lleva recuadro.
   - **PPT completa nueva:** una diapositiva por ubicación del plan con el diseño de las presentaciones de Beeyond (tomado de *MP BUEN FIN PREVIA*). El tipo de medio sale de una columna Formato/Tipo de medio del plan o, si no existe, del Nombre Crudos (`N. CIUDAD_TIPO_Nombre`). Gráficos de la plantilla en `assets/ppt/`.
   - **ZIP de fotos renombradas:** todas las fotos vinculadas, no solo las elegidas.

La interfaz usa los colores de Beeyond (igual que la app de Comprobación) y tiene tema claro y oscuro.

## Pendiente (igual que en la versión local)

- Crear/actualizar Google Slides (botón deshabilitado).
- Varios grupos de cara/versión por ubicación.
- Límite práctico: una campaña guarda hasta unas 5,000 fotos numeradas (1 MB por documento de Firestore). Si se llega, usa un identificador nuevo.

## Desarrollo

- Código sin dependencias ni compilación: `index.html`, `css/`, `js/`.
  - `js/core.js` — conciliación (port de `core.py`), `js/zip.js` — lector/escritor ZIP, `js/xlsx.js` — lector de Excel.
  - `js/backend-firebase.js` / `js/backend-demo.js` — datos y sesión.
- Pruebas: `npm test` (Node 22). Corren en GitHub Actions en cada cambio.
- Probar local: `python -m http.server 8000` en esta carpeta y abrir `http://localhost:8000/?demo` (o sin `?demo` para usar Firebase).
