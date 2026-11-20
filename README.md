# Beeyond · Testigos

App web interna de Beeyond Media para armar los **testigos fotográficos** de cada campaña: toma el plan de medios, el reporte de monitoreo de Media Nitro y el ZIP de fotos; relaciona cada foto con su ubicación del plan, la renombra con el **Nombre Crudos** y genera la **presentación (PPT)** con el diseño de Beeyond, lista para entregar o para cargar en la app de **Comprobación**.

- **App:** <https://beeyondmedia.github.io/BEEYOND-TESTIGOS/>
- **Prueba sin Firebase (modo demostración):** agrega `?demo` al final del link. Los datos se guardan solo en ese navegador.
- **Código:** <https://github.com/beeyondmedia/BEEYOND-TESTIGOS>
- **App relacionada:** Comprobación (<https://github.com/beeyondmedia/comprobacion>), que lee las PPT que genera esta app.

---

## Contenido

1. [Cómo trabaja la app (resumen)](#1-cómo-trabaja-la-app-resumen)
2. [Acceso](#2-acceso)
3. [Uso paso a paso](#3-uso-paso-a-paso)
4. [Archivos que acepta](#4-archivos-que-acepta)
5. [Cómo relaciona fotos y ubicaciones](#5-cómo-relaciona-fotos-y-ubicaciones)
6. [Nombres de los archivos](#6-nombres-de-los-archivos)
7. [La presentación (PPT)](#7-la-presentación-ppt)
8. [Actualizar una PPT ya hecha](#8-actualizar-una-ppt-ya-hecha)
9. [PPT en blanco (solo con el plan)](#9-ppt-en-blanco-solo-con-el-plan)
10. [Estatus del reporte de monitoreo y app de Comprobación](#10-estatus-del-reporte-de-monitoreo-y-app-de-comprobación)
11. [Qué se guarda y dónde](#11-qué-se-guarda-y-dónde)
12. [Mensajes y problemas comunes](#12-mensajes-y-problemas-comunes)
13. [Instalación (una sola vez)](#13-instalación-una-sola-vez)
14. [Para desarrolladores](#14-para-desarrolladores)
15. [Pendiente](#15-pendiente)

---

## 1. Cómo trabaja la app (resumen)

```
Plan de campaña (XLSX) ─┐
Reporte Media Nitro (XLSX) ─┼─► Revisar ─► Confirmar ubicaciones ─► Elegir fotos ─► Entregar
ZIP de fotos originales ─┤                                                         ├─ PPT nueva
PPT ya hecha (opcional) ─┘                                                         ├─ Actualizar PPT cargada
                                                                                   └─ ZIP de fotos renombradas
```

- **Todo se procesa en tu computadora.** Las fotos, los Excel y las PPT **no se suben a internet**; el navegador los lee directamente del archivo que elegiste. Por eso aguanta ZIP y PPT de cientos de MB.
- **Firebase** solo guarda lo que el equipo comparte por campaña (equivalencias de direcciones confirmadas, numeración de las fotos y fotos elegidas) y controla quién entra.
- **Las fotos no se alteran:** el ZIP renombrado copia los bytes originales, y en la PPT (calidad *Original*) las fotos 4:3 entran tal cual vienen.

## 2. Acceso

- Se entra con **Google**, con una cuenta **verificada @beeyondmedia.com** que además esté **dada de alta y activa** en *Usuarios*. Las reglas de Firestore lo validan en el servidor.
- **Administrador principal:** `eliot.fabela@beeyondmedia.com`. Entra sin alta previa y en **Usuarios** da de alta, cambia el rol o da de baja a las demás personas (no se borran: quedan como *Baja*).
- **Roles:** *Usuario* (trabaja campañas) y *Administrador* (además administra usuarios).
- Para cambiar el administrador principal hay que editar `js/config.js` **y** `firestore.rules`.

## 3. Uso paso a paso

### Paso 1 · Archivos del lote

1. **Identificador de campaña:** escríbelo como quieras (`MERCADO LIBRE Buen Fin Previa`); se convierte solo a minúsculas y guiones (`mercado-libre-buen-fin-previa`). Todo lo que se guarda en Firebase va bajo ese identificador; usa el mismo para todos los lotes de una campaña. La lista sugiere los que ya existen.
2. Elige los archivos:
   - **Plan de campaña** (XLSX).
   - **Reporte Media Nitro** (XLSX).
   - **Fotografías originales** (ZIP, tal como lo manda Media Nitro).
   - **PPT ya hecha** (opcional): si la cargas, la app solo agrega lo que le falta (ver [sección 8](#8-actualizar-una-ppt-ya-hecha)).
3. Presiona **Revisar**. El mensaje verde dice qué hoja usó del plan y del reporte, y si omitió renglones.

> Si solo tienes el plan, abre **¿Solo tienes el plan? Genera la PPT con los espacios de fotos vacíos** (ver [sección 9](#9-ppt-en-blanco-solo-con-el-plan)).

### Paso 2 · Confirmar ubicaciones

- Muestra el resumen: ubicaciones del plan, con fotos, sin fotos, fotos vinculadas, códigos del reporte que sí están en el ZIP y fotos del ZIP sin referencia.
- Las direcciones del reporte que **no** coincidieron solas aparecen para confirmar. Arriba de cada lista salen **las más parecidas**; si una es claramente la correcta ya viene seleccionada (en amarillo). Revisa y presiona **Confirmar**. La equivalencia queda guardada **para toda la campaña**: no se vuelve a preguntar en los siguientes lotes.
- *Faltantes y conflictos* lista los códigos del reporte que no vienen en el ZIP.

### Paso 3 · Elegir fotos por ubicación

- **Filtros** (con contador): *Todas* · *Con fotos* · *Pendientes (sin fotos)* · *Con fotos sin elegir* · *Con comentarios del reporte* · y, si cargaste una PPT, *Incompletas en PPT* y *Por agregar o completar en PPT*. Se combinan con el buscador.
- Cada ubicación muestra etiquetas: número de fotos, elegidas, estatus del reporte y su situación en la PPT cargada (*En PPT*, *Falta en PPT*, *caben N más*…).
- **Fotos por diapositiva:** de 1 a 6. Define el acomodo de la diapositiva.
- Marca las fotos (clic en la tarjeta o en la casilla). Botones **Elegir todas** / **Quitar todas**. No hay tope: si eliges más que *Fotos por diapositiva*, la ubicación continúa en otra diapositiva igual.
- Presiona **Guardar selección** (queda guardada en Firebase para el equipo).
- **Vista previa:** muestra la diapositiva como saldrá, con los espacios vacíos y el recuadro de estatus. Si la ubicación ocupa varias diapositivas, usa **‹ ›**.
- **Solo van las fotos que elijas.** Sin selección, la diapositiva sale con espacios vacíos para llenarlos a mano.

### Paso 4 · Descargar y entregar

- **Título de la presentación** (ej. `MP BUEN FIN PREVIA`). Se recuerda por campaña en tu navegador.
- **Calidad de las fotos:** *Original (sin reducir)* o *Ligera (archivo más pequeño)*. Ver [7.4](#74-calidad-de-las-fotos).
- **Actualizar PPT cargada** (solo si cargaste una PPT): antes de descargar te dice cuántas ubicaciones agrega y cuántas completa. Descarga `nombre (actualizada).pptx`.
- **Descargar PPT completa nueva:** una diapositiva (o más) por cada ubicación del plan.
- **Descargar ZIP de fotos renombradas:** todas las fotos vinculadas del lote (no solo las elegidas), renombradas y sin recomprimir.

## 4. Archivos que acepta

### Plan de campaña (XLSX)

- La app revisa **todas las hojas**, primero las visibles y luego las ocultas, y usa la primera que tenga las columnas necesarias. Así funciona aunque los datos no estén en la primera hoja.
- **Columnas** (no importan mayúsculas, acentos ni espacios; el encabezado puede no estar en el renglón 1):

| Dato | Columnas que reconoce | Obligatoria |
|---|---|---|
| Ubicación | `Ubicación` o `Dirección` | Sí |
| Nombre | `Nombre Crudos` | No (ver abajo) |
| Proveedor | `Media Owner` o `Proveedor` | No |
| Ciudad | `Ciudad` | No |
| Tipo de medio | `Venue Type`, `Tipo de medio`, `Tipo de soporte`, `Tipo de ubicación`, `Formato` o `Tipo` | No |
| Número | `# slide` (solo si no hay Nombre Crudos) | No |

- **Sin columna Nombre Crudos:** se usa la dirección como nombre: `N. Dirección`, con N de la columna `# slide` o el número de renglón. Direcciones repetidas se distinguen con `(2)`, `(3)`…
- **Sin columna Ciudad:** se toma del Nombre Crudos (`1. CDMX_Columna_…` → `CDMX`) o de la dirección (CDMX, GDL, MTY, EDOMEX, QRO, PUE, CUN).
- **Tipo de medio:** si no hay columna, se toma del Nombre Crudos (`29. CDMX_LANDMARK_Tamarindos` → `LANDMARK`).
- **Renglones de respaldo** sin nombre propio (p. ej. `SITIO DE BACK` repetido) se omiten y se avisa. Si hay un Nombre Crudos real repetido, la app se detiene y lo dice.

### Reporte de Media Nitro (XLSX)

- Columnas obligatorias: **Dirección** y **FotoCódigos** (códigos separados por coma).
- Opcionales: **Proveedor**, **Ciudad**, **Campaña** (versión), **Estatus** (comentario del monitoreo; ver [sección 10](#10-estatus-del-reporte-de-monitoreo-y-app-de-comprobación)).
- También se busca en todas las hojas.

### ZIP de fotos

- Las fotos se reconocen por su **código = nombre del archivo sin extensión** (`A3443031.jpg` → `A3443031`), en cualquier carpeta del ZIP.
- Acepta JPG, JPEG y PNG. Ignora los archivos `__MACOSX` / `._…` que agrega la Mac.
- Si un código aparece dos veces en el ZIP, la app se detiene y lo dice.
- **No muevas, renombres ni descomprimas el ZIP** mientras trabajas (ni lo dejes en una carpeta que OneDrive/Drive esté sincronizando): el navegador lo lee directamente del archivo.

### PPT ya hecha (opcional)

- Una presentación 16:9 (10 × 5.63 in), como las de la plantilla de Beeyond o las que genera esta app.
- Cada diapositiva se reconoce por el **número con el que empieza su texto de ubicación** (`29. TAMARINDOS` ↔ `29. CDMX_LANDMARK_Tamarindos`); si no tiene número, por el texto de la ubicación.

## 5. Cómo relaciona fotos y ubicaciones

1. Cada renglón del reporte se compara con el plan por **dirección idéntica** (sin importar mayúsculas, acentos ni signos).
2. Si hay varias ubicaciones con la misma dirección, **desempatan** la ciudad y luego el proveedor. El proveedor se compara por palabras clave porque suele venir escrito distinto (`GPO POL` = `Grupo Pol Devices`, `WEST MEDIA` = `West Media Devices`).
3. Lo que no coincide **no se adivina**: se pide confirmar en el paso 2 (con sugerencias) y la respuesta queda guardada para la campaña.
4. Cada código de foto del reporte se busca en el ZIP. Si un mismo código queda en dos ubicaciones distintas, es un **conflicto** y no se puede exportar el ZIP hasta resolverlo.

## 6. Nombres de los archivos

- **Formato:** `Nombre Crudos` completo (con su número) + `_01`, `_02`… + extensión original en minúsculas.
  Ej.: `1. CDMX_AEROPUERTO, T1-ENTRADA PRINCIPAL EXTERIOR_ML_BF_01.jpg`
- Los caracteres que Windows no admite (`/ \ : * ? " < > |`) se cambian por guion **solo en el nombre del archivo**.
- **Numeración estable por campaña:** una foto conserva su número en todos los lotes; las fotos nuevas continúan la secuencia (`_03`, `_04`…). Nunca se repite un nombre.

## 7. La presentación (PPT)

### 7.1 Diseño

Tomado de *MP BUEN FIN PREVIA*: diapositiva 16:9 con panel coral a la izquierda (título de la presentación, número y ubicación, tipo de medio y ciudad), fotos a la derecha y logo de Beeyond. Los gráficos están en `assets/ppt/`. Usa la fuente **Rubik** (debe estar instalada en la computadora que abre la PPT para verse igual).

### 7.2 Acomodo de las fotos (según *Fotos por diapositiva*)

| Fotos por diapositiva | Acomodo |
|---|---|
| 1 | Una grande al centro |
| 2 | Una arriba de otra, centradas |
| 3 | Dos arriba y una centrada abajo |
| 4 | Cuadrícula 2 × 2 |
| 5 | Tres filas de 2 (la última con 1 centrada) |
| 6 | Tres filas de 2 (dos columnas de 3) |

- Todas las fotos de una diapositiva son del mismo tamaño y 4:3, en orden de izquierda a derecha y de arriba abajo.
- **Siempre se respeta el acomodo:** si eliges menos fotos, los espacios restantes quedan **vacíos** (marcadores de imagen de PowerPoint: clic en el ícono para insertar la foto y se ajusta sola). Cada espacio vacío se llama como el archivo que le toca (`Nombre Crudos_03`…), visible en *Inicio › Organizar › Panel de selección*.

### 7.3 Más fotos que *Fotos por diapositiva*

La ubicación continúa en **diapositivas seguidas iguales** (mismo panel y nombre) hasta acomodar todas las fotos; la última se completa con espacios vacíos. Ej.: 42 fotos con 6 por diapositiva = 7 diapositivas. El recuadro de estatus va solo en la primera.

### 7.4 Calidad de las fotos

- **Original (por defecto):** si la foto ya es 4:3 y no viene girada, entra **tal cual** (mismos bytes, sin reducir ni recomprimir). Si no, se recorta al centro a 4:3 **conservando su resolución** (JPEG calidad 92) y se corrige la orientación.
- **Ligera:** recorta a 4:3 y reduce a 1400 px de ancho; el archivo pesa mucho menos.
- La app no carga todas las fotos en memoria al armar la PPT, así que aguanta presentaciones grandes; aun así, con *Original* el archivo final pesa más (p. ej. ~37 MB por 42 fotos).

### 7.5 Ubicaciones sin fotos

Llevan los espacios vacíos y, en el panel coral, el recuadro **PENDIENTE · Sin registro fotográfico**.

## 8. Actualizar una PPT ya hecha

Carga tu PPT en el paso 1 y usa **Actualizar PPT cargada** en el paso 4. **Tu archivo original no se modifica:** se descarga una copia `nombre (actualizada).pptx`. Las diapositivas que no cambian se copian tal cual.

| Situación de la ubicación en tu PPT | Etiqueta | Qué hace al actualizar |
|---|---|---|
| No está | *Falta en PPT* | La **agrega** en el orden del plan (después de la ubicación anterior), con las fotos elegidas o con espacios vacíos. |
| Está, sin ninguna foto | *Sin fotos en PPT · elige fotos* | Si elegiste fotos, **rearma** esa diapositiva con ellas (y sigue en otras si son más). Si no, la deja igual. |
| Está, con espacio en su última diapositiva | *En PPT · N fotos · caben N más* | Si elegiste fotos, las agrega **en esa misma diapositiva** junto con las que ya tenía; lo que no quepa sigue en diapositivas nuevas **justo después**. Si no, la deja igual. |
| Está, con sus diapositivas llenas | *En PPT · N fotos* | Si elegiste fotos (p. ej. una 3ª versión), van en **diapositivas nuevas justo después** de las suyas. Si no, la deja igual. |

- La app **no sabe cuáles fotos del ZIP ya están en tu PPT** (dentro de la PPT las fotos no traen su código). Por eso **solo agrega las que tú elijas**. Si recargas el mismo lote y aparecen marcadas fotos que ya están en tu PPT, desmárcalas.
- Las diapositivas que se rearman llevan tus mismas fotos con el diseño de Beeyond; si les habías hecho ajustes a mano (texto, recorte), se pierden.
- Si una diapositiva no empieza con el número de su ubicación, la app no la reconoce y la tomará como faltante (agregará otra; no borra la tuya).

## 9. PPT en blanco (solo con el plan)

En el paso 1, abre **¿Solo tienes el plan? Genera la PPT con los espacios de fotos vacíos**:

1. Elige solo el **plan** (no hace falta el reporte ni el ZIP).
2. Escribe el título y elige **Espacios por diapositiva** (1 a 6).
3. **Generar PPT en blanco.**

Sale una diapositiva por ubicación con el diseño de Beeyond y los espacios vacíos nombrados `Nombre Crudos_01`, `_02`… Las fotos que insertes a mano en esos espacios las cuentan esta app (al actualizar) y la de Comprobación.

## 10. Estatus del reporte de monitoreo y app de Comprobación

La columna **Estatus** del reporte (comentario del monitoreo) se clasifica por ubicación:

| Estatus | Comentarios que lo activan |
|---|---|
| **Con observaciones** | "arte no colocado", "esta versión no se exhibió" (también si vienen junto con otro problema) |
| **En revisión** | "leds dañados", "no enciende", "no cambia de anuncio" y **cualquier otro comentario** (vidrio roto, zona de obras, anuncio tapado…) |
| **Pendiente** | Ubicación sin fotos ni comentario |
| *(sin recuadro)* | "sin problemas" |

- Va en un **recuadro en el panel coral** de la primera diapositiva de la ubicación (no ocupa lugar de foto). Si el comentario aplica solo a una versión, dice cuál (`MERCADO PAGO 24 MSI: esta version no se exhibio`).
- El recuadro se llama `BT-ESTATUS`. Al cargar la PPT en **Comprobación**:
  - *Con observaciones* / *En revisión*: el soporte toma ese estatus (no Comprobado) y el texto se agrega a **Comentarios** sin repetir lo que ya había.
  - *Pendiente*: el soporte no se toca.
  - Las demás ubicaciones con fotos quedan **Comprobado**.
- Comprobación guarda el **número real de fotos** (sin tope) y reconoce las diapositivas de continuación (seguidas y con el mismo texto) como el mismo soporte, sumando sus fotos.

## 11. Qué se guarda y dónde

| Dónde | Qué |
|---|---|
| **Tu computadora** | Plan, reporte, ZIP y PPT: se leen del archivo; no se suben. |
| **Firebase · `campanas/{identificador}`** | `equivalencias` (direcciones confirmadas), `numeracion` (número fijo de cada foto), `seleccion` (fotos elegidas por ubicación) y `loteFirma` (para saber si el lote cambió). |
| **Firebase · `usuarios/{correo}`** | Rol y si está activo. |
| **Tu navegador** | Título de la presentación por campaña y tema claro/oscuro. |

- Volver a revisar **el mismo lote** conserva la selección; un **lote diferente** la limpia (las equivalencias y la numeración se conservan siempre).
- Límite práctico: una campaña guarda hasta unas 5,000 fotos numeradas (1 MB por documento de Firestore). Si se llega, usa un identificador nuevo.

## 12. Mensajes y problemas comunes

| Mensaje / síntoma | Causa y solución |
|---|---|
| *No se encontraron las columnas … en ninguna hoja del plan* | Ninguna hoja tiene `Ubicación` o `Dirección`. Revisa el encabezado de la hoja con los datos. |
| *Nombre Crudos repetido en el plan* | Dos ubicaciones con el mismo nombre real; corrige el Excel. |
| *Códigos de foto duplicados en el ZIP* | El mismo código está dos veces en el ZIP; quita el repetido. |
| Muchas direcciones por confirmar en el paso 2 | Las direcciones del reporte están escritas distinto a las del plan. Confírmalas una vez; quedan guardadas para la campaña. |
| Miniaturas *No se pudo leer* | El ZIP se movió, cambió o se está sincronizando. Cópialo a Descargas o Escritorio, vuelve a elegirlo y presiona **Revisar**. |
| *Este dominio no está autorizado en Firebase* | Falta agregar el dominio en Firebase › Authentication › Configuración › Dominios autorizados. |
| *Tu cuenta … no tiene alta activa* | Pide al administrador que te dé de alta en **Usuarios**. |
| *La presentación cargada no tiene el tamaño 16:9 de la plantilla* | Solo se pueden actualizar PPT 16:9 de 10 × 5.63 in. |
| No veo los cambios nuevos | Recarga con **Ctrl + Shift + R**. |

## 13. Instalación (una sola vez)

### Firebase — proyecto "Beeyond Testigos" (ID `beeyond-testigos-9f3e2`, cuenta de Eliot)

1. <https://console.firebase.google.com/project/beeyond-testigos-9f3e2>
2. **Authentication › Método de acceso › Google › Habilitar.**
3. **Firestore Database › Crear base de datos** (edición Standard, ID `(default)`, ubicación `nam5`, modo producción).
4. **Firestore › Reglas:** pegar `firestore.rules` y **Publicar** (repetir cada vez que cambie ese archivo).
5. **Authentication › Configuración › Dominios autorizados:** `beeyondmedia.github.io`.

La configuración web del proyecto está en `js/config.js` (no es secreta: la seguridad la dan las reglas de Firestore).

### Publicación

- **GitHub Pages (la que se usa):** *Settings › Pages › Deploy from a branch › `main` / `(root)`*. Cada cambio en `main` se publica solo en 1–2 minutos.
- **Firebase Hosting (opcional):** agregar el secreto `FIREBASE_SERVICE_ACCOUNT` (clave JSON de una cuenta de servicio con permisos de Hosting y reglas) en *Settings › Secrets and variables › Actions*. El flujo `.github/workflows/deploy.yml` corre las pruebas y publica en `https://beeyond-testigos-9f3e2.web.app` junto con las reglas. Sin ese secreto solo corre las pruebas.

### Primer uso

Entrar con `eliot.fabela@beeyondmedia.com` → **Usuarios** → dar de alta los correos del equipo.

## 14. Para desarrolladores

Sin dependencias ni compilación: HTML + CSS + módulos JavaScript que corren en el navegador.

| Archivo | Qué hace |
|---|---|
| `index.html`, `css/app.css` | Interfaz (marca Beeyond, tema claro/oscuro). |
| `js/main.js` | Flujo de pantallas, filtros, selección, vista previa y descargas. |
| `js/core.js` | Lógica de conciliación: lectura del plan/reporte, emparejamiento, sugerencias, numeración, nombres de archivo y clasificación del Estatus. Funciones puras (se prueban con Node). |
| `js/zip.js` | Lector/escritor ZIP propio: lee solo el índice, descomprime con `DecompressionStream` y copia bytes sin recomprimir. |
| `js/xlsx.js` | Lector de Excel (todas las hojas). |
| `js/ppt.js` | Genera la PPT con PptxGenJS (`js/vendor/`, licencia MIT): diseño, acomodo de 1–6 fotos, continuación, espacios vacíos (marcadores de imagen), recuadro de estatus y fotos en calidad original (se cambian al empaquetar). |
| `js/pptmerge.js` | Lee una PPT ya hecha y la actualiza: reconoce diapositivas, agrega, rearma o continúa ubicaciones sin tocar el resto. |
| `js/backend-firebase.js` / `js/backend-demo.js` | Sesión (Google) y datos (Firestore) / modo demostración en el navegador. |
| `js/config.js` | Configuración de Firebase, dominio y administrador principal. |
| `firestore.rules` | Reglas de seguridad (acceso por dominio + alta activa; campos permitidos). |
| `assets/ppt/` | Gráficos de la plantilla de Beeyond. |
| `tests/core.test.mjs` | Pruebas (`npm test`, Node 22). Corren en GitHub Actions en cada cambio. |

- **Probar local:** `python -m http.server 8000` en la carpeta y abrir `http://localhost:8000/?demo` (o sin `?demo` para usar Firebase).
- Es la evolución de la versión local en Python (`server.py` / `core.py`): misma lógica de conciliación.

## 15. Pendiente

- Crear o actualizar la presentación directamente en Google Slides.
- Varios grupos de cara/versión con título propio dentro de una misma ubicación.
