# Horarios

Webapp para consultar y organizar los horarios semanales de sala y cocina.

- **Empleados** (`/`): eligen su nombre y ven su semana; también pueden ver todo el equipo por día o la semana completa, y los horarios pasados.
- **Editor** (`/admin.html`): protegido con PIN. Se edita en la tablet, se crean semanas nuevas copiando la anterior, se exporta la imagen para WhatsApp y se publica.

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

## Avisos push

Cada empleado los activa desde su pantalla (en iPhone hace falta añadir la web a la pantalla de inicio, iOS 16.4+). Las suscripciones se guardan cifradas en `data/avisos.json`; los commits que solo cambian ese archivo no vuelven a desplegar la web. Desde el editor se avisa a todos cuando el horario está listo, o solo a quienes les cambió después.

## Probar en local

```sh
npm run dev   # http://localhost:3000 — PIN 123456, guarda en el archivo local
```
