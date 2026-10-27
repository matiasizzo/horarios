# Horarios

Webapp para consultar y organizar los horarios semanales de sala y cocina.

- **Empleados** (`/`): eligen su nombre y ven su semana; también pueden ver todo el equipo por día o la semana completa, y los horarios pasados.
- **Editor** (`/admin.html`): protegido con PIN. Se edita en la tablet, se crean semanas nuevas copiando la anterior, se exporta la imagen para WhatsApp y se publica.
- **Control de stock** (`/stock.html`): los cocineros cuentan su zona en el móvil y el jefe de cocina recibe el pedido agrupado por proveedor.
- **Gestión** (`/gestion.html`): para la dueña, en tablet o web. Albaranes y facturas (se leen solos desde la foto), precios de compra, escandallos y ventas del TPV.

## Cómo funciona sin base de datos

Todos los horarios viven en `data/horarios.json`. Al pulsar **Publicar**, la función `api/publicar.js` guarda ese archivo en este repositorio de GitHub y Vercel vuelve a publicar la web sola (1–2 minutos). La semana que ven los empleados es la más reciente que ya empezó; las anteriores pasan solas a "Horarios pasados".

## Variables de entorno en Vercel

| Variable | Valor |
|---|---|
| `ADMIN_PIN` | PIN del editor (mejor de 6 cifras o más) |
| `GITHUB_TOKEN` | Token *fine-grained* de GitHub con permiso **Contents: Read and write** solo sobre este repo |
| `GITHUB_BRANCH` | Rama que publica Vercel (por defecto `main`) |
| `GITHUB_REPO` | Opcional, por defecto `matiasizzo/horarios` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Claves de los avisos push. Se generan en el editor con "Configurar avisos" |
| `STOCK_CLAVE` | Clave con la que se cifran `data/stock.json` y `data/gestion.json`. Si se pierde o se cambia, no se pueden leer |
| `ANTHROPIC_API_KEY` | Opcional. Clave de la API de Anthropic para leer los albaranes desde la foto; sin ella se rellenan a mano |

## Avisos push

Cada empleado los activa desde su pantalla (en iPhone hace falta añadir la web a la pantalla de inicio, iOS 16.4+). Las suscripciones se guardan cifradas en `data/avisos.json`; los commits que solo cambian ese archivo no vuelven a desplegar la web. Desde el editor se avisa a todos cuando el horario está listo, o solo a quienes les cambió después.

## Control de stock

- **Cocineros** (PIN de cocina): eligen su nombre y una zona (Parrilla, Cocina…), marcan cada producto como **Hay** o **Pedir N** con una nota opcional y lo envían. Lo que van marcando se guarda en el móvil hasta enviarlo. Entran desde su horario (botón *Control de stock*) o en `/stock.html`.
- **Jefe de cocina** (su PIN, o el `ADMIN_PIN`): recibe un aviso cuando llega cada zona, ve el pedido agrupado por proveedor, ajusta cantidades, lo manda por WhatsApp (mensaje ya escrito) o llama, marca qué proveedores ya están pedidos y cierra el control, que queda en el historial. Desde ahí también puede pedir el control a los cocineros (aviso a quienes trabajan hoy según el horario), editar el catálogo y descargar el historial en CSV.
- Los PINs del jefe y de los cocineros se crean en **Ajustes** entrando con el `ADMIN_PIN`.
- Catálogo, proveedores (con sus teléfonos), pedidos e historial viven en `data/stock.json`, **cifrado** con `STOCK_CLAVE` porque el repo es público. Como con los avisos, los commits que solo cambian ese archivo no vuelven a desplegar la web.

## Gestión

- **Acceso**: con la contraseña de la dueña (se crea en *Ajustes* entrando con el `ADMIN_PIN`) o con el `ADMIN_PIN`.
- **Albaranes y facturas**: se suben fotos o PDF. Cada página se envía a Claude (`api/_lector.js`), que devuelve proveedor, número, fecha, totales y líneas; la dueña las revisa contra el papel y las guarda. Si varias fotos son documentos distintos, se leen y se guardan todos como "por revisar". Lo que corrige (el nombre de cada producto de cada proveedor) se recuerda para el siguiente. Avisa si las líneas no cuadran con la base, si faltan páginas, si un documento ya estaba subido y si se cobra algo marcado como no entregado (con el texto de la reclamación ya escrito).
- **Fotos**: no se guardan en el servidor, solo en el dispositivo donde se subieron (IndexedDB).
- **Precios**: último precio de cada ingrediente, su historial y las subidas. Un ingrediente se puede renombrar o unir con otro en todos los albaranes a la vez.
- **Escandallos**: cada plato de la carta puede tener varios ingredientes (cantidad en crudo, rendimiento tras limpiar y precio del último albarán o escrito a mano). Se compara con el precio de carta y el objetivo de coste.
- **Ventas**: se importan los CSV del TPV, el diario (`Fecha|Documentos|Importe|Promedio`) y el de ventas por artículo de cada mes (`Nombre|Unidades|Importe`, sin fechas: se indica el mes al importarlo).
- Todo vive en `data/gestion.json`, cifrado con `STOCK_CLAVE`. Los commits que solo cambian ese archivo no vuelven a desplegar la web.
- La lectura usa el modelo `claude-opus-5-5` con `fallbacks: "default"` (si el modelo rechaza una petición, la API la repite con el modelo de reserva). Cuesta del orden de 5 a 10 céntimos por página.

## Probar en local

```sh
npm run dev   # http://localhost:3000 — PIN 123456, guarda en el archivo local
```

Para el stock y la gestión hace falta además `STOCK_CLAVE` en el entorno (`STOCK_CLAVE=… npm run dev`); para la lectura de albaranes, `ANTHROPIC_API_KEY`.
