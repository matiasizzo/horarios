# Horarios

Webapp para consultar y organizar los horarios semanales de sala y cocina.

- **Empleados** (`/`): eligen su nombre y ven su semana; también pueden ver todo el equipo por día o la semana completa, y los horarios pasados.
- **Editor** (`/admin.html`): protegido con PIN. Se edita en la tablet, se crean semanas nuevas copiando la anterior, se exporta la imagen para WhatsApp y se publica.
- **Control de stock** (`/stock.html`): los cocineros cuentan su zona en el móvil y el jefe de cocina recibe el pedido agrupado por proveedor.

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
| `STOCK_CLAVE` | Clave con la que se cifra `data/stock.json`. Si se pierde o se cambia, el stock no se puede leer |

## Avisos push

Cada empleado los activa desde su pantalla (en iPhone hace falta añadir la web a la pantalla de inicio, iOS 16.4+). Las suscripciones se guardan cifradas en `data/avisos.json`; los commits que solo cambian ese archivo no vuelven a desplegar la web. Desde el editor se avisa a todos cuando el horario está listo, o solo a quienes les cambió después.

## Control de stock

- **Cocineros** (PIN de cocina): eligen su nombre y una zona (Parrilla, Cocina…), marcan cada producto como **Hay** o **Pedir N** con una nota opcional y lo envían. Lo que van marcando se guarda en el móvil hasta enviarlo. Entran desde su horario (botón *Control de stock*) o en `/stock.html`.
- **Jefe de cocina** (su PIN, o el `ADMIN_PIN`): recibe un aviso cuando llega cada zona, ve el pedido agrupado por proveedor, ajusta cantidades, lo manda por WhatsApp (mensaje ya escrito) o llama, marca qué proveedores ya están pedidos y cierra el control, que queda en el historial. Desde ahí también puede pedir el control a los cocineros (aviso a quienes trabajan hoy según el horario), editar el catálogo y descargar el historial en CSV.
- Los PINs del jefe y de los cocineros se crean en **Ajustes** entrando con el `ADMIN_PIN`.
- Catálogo, proveedores (con sus teléfonos), pedidos e historial viven en `data/stock.json`, **cifrado** con `STOCK_CLAVE` porque el repo es público. Como con los avisos, los commits que solo cambian ese archivo no vuelven a desplegar la web.

## Probar en local

```sh
npm run dev   # http://localhost:3000 — PIN 123456, guarda en el archivo local
```

Para el stock hace falta además `STOCK_CLAVE` en el entorno (`STOCK_CLAVE=… npm run dev`).
