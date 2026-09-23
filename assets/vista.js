// Vista de consulta para los empleados.
import {
  AREAS, DIAS, DIAS_CORTOS, DIAS_ABIERTOS, diasDe, diaDelMes, empleado, escapar, formatoHoras,
  formatoTramo, lunesDe, minutosDia, minutosSemana, ordenHora, rangoSemana, semanaVigente,
  semanasPasadas,
} from './common.js';

const app = document.getElementById('app');
let datos = null;
// Estado de la vista de equipo (se mantiene al navegar entre pantallas).
const equipo = { area: 'sala', dia: null, modo: 'dia' };

function cabecera(titulo, sub, volver) {
  return `
    <header class="cabecera"><div class="cabecera-fila">
      ${volver ? `<a class="volver" href="${volver}" aria-label="Volver">‹</a>` : ''}
      <div style="flex:1">
        <h1>${escapar(titulo)}</h1>
        ${sub ? `<div class="sub">${escapar(sub)}</div>` : ''}
      </div>
    </div></header>`;
}

function avisoSemana(vigente) {
  const lunesHoy = lunesDe();
  if (!vigente) return '<div class="aviso">Todavía no hay horarios publicados.</div>';
  if (vigente === lunesHoy) return '';
  return `<div class="aviso">El horario de esta semana todavía no está publicado. Se muestra la semana del ${rangoSemana(vigente)}.</div>`;
}

function indiceHoy(semana) {
  const hoy = lunesDe();
  if (hoy !== semana) return -1;
  return (new Date().getDay() + 6) % 7;
}

function pantallaInicio() {
  const vigente = semanaVigente(datos);
  const grupos = AREAS.map((area) => `
    <h2>${area.nombre}</h2>
    <div class="nombres">
      ${datos.empleados[area.id].map((e) => `<a class="nombre-btn" href="#/yo/${e.id}">${escapar(e.nombre)}</a>`).join('')}
    </div>`).join('');
  const hayPasadas = semanasPasadas(datos, vigente).length > 0;
  return `
    ${cabecera('Horarios', vigente ? `Semana ${rangoSemana(vigente)}` : '')}
    <main>
      ${avisoSemana(vigente)}
      <p style="margin:0 0 4px;font-size:1.1rem;font-weight:600">¿Quién eres?</p>
      ${grupos}
      <div class="acciones">
        ${vigente ? `<a class="boton" href="#/equipo">Ver todo el equipo</a>` : ''}
        ${hayPasadas ? `<a class="boton secundario" href="#/pasados">Horarios pasados</a>` : ''}
      </div>
      ${avisoInstalar()}
    </main>`;
}

function pantallaPersona(id) {
  const e = empleado(datos, id);
  const vigente = semanaVigente(datos);
  if (!e) return pantallaNoEncontrada();
  if (!vigente) return `${cabecera(e.nombre, '', '#/')}<main>${avisoSemana(null)}</main>`;
  const dias = diasDe(datos.semanas[vigente], id);
  const hoy = indiceHoy(vigente);
  const tarjetas = dias.map((tramos, i) => {
    const cerrado = !DIAS_ABIERTOS.includes(i);
    const clases = ['dia'];
    if (i === hoy) clases.push('hoy');
    if (cerrado) clases.push('cerrado');
    else if (!tramos.length) clases.push('libre');
    let contenido;
    if (cerrado) contenido = '<span class="etiqueta-libre">Cerrado</span>';
    else if (!tramos.length) contenido = '<span class="etiqueta-libre">Libre</span>';
    else contenido = tramos.map((t) => `<span class="tramo">${formatoTramo(t)}</span>`).join('');
    return `
      <div class="${clases.join(' ')}">
        <div class="dia-fecha"><div class="dn">${DIAS_CORTOS[i]}</div><div class="dd">${diaDelMes(vigente, i)}</div></div>
        <div class="dia-tramos">${contenido}</div>
        ${tramos.length ? `<div class="dia-horas">${formatoHoras(minutosDia(tramos))} h</div>` : ''}
        ${i === hoy ? '<span class="chip-hoy">HOY</span>' : ''}
      </div>`;
  }).join('');
  return `
    ${cabecera(e.nombre, `${e.area === 'sala' ? 'Sala' : 'Cocina'} · Semana ${rangoSemana(vigente)}`, '#/')}
    <main>
      ${avisoSemana(vigente)}
      <div class="resumen">
        <span style="color:var(--texto-suave)">Mis horarios</span>
        <span class="total">${formatoHoras(minutosSemana(dias))} <small>h esta semana</small></span>
      </div>
      <div class="dias">${tarjetas}</div>
      <div class="acciones">
        <a class="boton secundario" href="#/equipo" data-area="${e.area}">Ver todo el equipo</a>
      </div>
    </main>`;
}

function diaPorDefecto(semana) {
  const hoy = indiceHoy(semana);
  return DIAS_ABIERTOS.includes(hoy) ? hoy : DIAS_ABIERTOS[0];
}

function listaDelDia(semana) {
  const trabajan = datos.empleados[equipo.area]
    .map((e) => ({ e, tramos: diasDe(semana, e.id)[equipo.dia] }))
    .filter((x) => x.tramos.length)
    .sort((a, b) => ordenHora(a.tramos[0][0]) - ordenHora(b.tramos[0][0]));
  if (!trabajan.length) return '<div class="lista"><div class="vacio">Nadie trabaja este día.</div></div>';
  return `<div class="lista">${trabajan.map(({ e, tramos }) => `
    <div class="fila">
      <span class="quien">${escapar(e.nombre)}</span>
      <span class="cuando">${tramos.map((t) => `<span class="tramo">${formatoTramo(t)}</span>`).join('')}</span>
    </div>`).join('')}</div>`;
}

function tablaSemana(semana, lunes, area) {
  const filas = datos.empleados[area].map((e) => {
    const dias = diasDe(semana, e.id);
    const celdas = DIAS_ABIERTOS.map((i) => {
      const tr = dias[i];
      return `<td>${tr.length ? tr.map(formatoTramo).join('<br>') : '<span class="libre">–</span>'}</td>`;
    }).join('');
    return `<tr><td class="nom">${escapar(e.nombre)}</td>${celdas}<td class="tot">${formatoHoras(minutosSemana(dias))}</td></tr>`;
  }).join('');
  const encabezado = DIAS_ABIERTOS.map((i) => `<th>${DIAS_CORTOS[i]} ${diaDelMes(lunes, i)}</th>`).join('');
  return `<div class="tabla-scroll"><table class="semana">
    <thead><tr><th class="nom"></th>${encabezado}<th>Total</th></tr></thead>
    <tbody>${filas}</tbody></table></div>`;
}

function pantallaEquipo(fecha) {
  const vigente = semanaVigente(datos);
  const lunes = fecha || vigente;
  const semana = datos.semanas[lunes];
  const esPasada = fecha && fecha !== vigente;
  if (!semana || (fecha && fecha > vigente)) return pantallaNoEncontrada();
  if (equipo.dia === null) equipo.dia = diaPorDefecto(lunes);
  const volver = esPasada ? '#/pasados' : '#/';

  const pestanas = AREAS.map((a) => `<button data-area="${a.id}" aria-pressed="${equipo.area === a.id}">${a.nombre}</button>`).join('');
  const hoy = indiceHoy(lunes);
  const chips = DIAS_ABIERTOS.map((i) => `
    <button data-dia="${i}" aria-pressed="${equipo.dia === i}">
      <span class="dn">${i === hoy ? 'Hoy' : DIAS_CORTOS[i]}</span><span class="dd">${diaDelMes(lunes, i)}</span>
    </button>`).join('');

  const cuerpo = equipo.modo === 'dia'
    ? `<div class="chips">${chips}</div>
       <h2>${DIAS[equipo.dia]} ${diaDelMes(lunes, equipo.dia)}</h2>
       ${listaDelDia(semana)}`
    : tablaSemana(semana, lunes, equipo.area);

  return `
    ${cabecera(esPasada ? 'Horario pasado' : 'Todo el equipo', `Semana ${rangoSemana(lunes)}`, volver)}
    <main>
      ${esPasada ? '' : avisoSemana(vigente)}
      <div class="pestanas">${pestanas}</div>
      <div class="selector-vista">
        <button class="link-btn" data-modo="${equipo.modo === 'dia' ? 'semana' : 'dia'}">
          ${equipo.modo === 'dia' ? 'Ver semana completa' : 'Ver por día'}
        </button>
      </div>
      ${cuerpo}
    </main>`;
}

function pantallaPasados() {
  const vigente = semanaVigente(datos);
  const lista = semanasPasadas(datos, vigente);
  return `
    ${cabecera('Horarios pasados', '', '#/')}
    <main>
      ${lista.length ? `<div class="semanas-pasadas">${lista.map((f) => `
        <a class="nombre-btn" href="#/equipo/${f}"><span>Semana ${rangoSemana(f)}</span><span>›</span></a>`).join('')}</div>`
        : '<div class="vacio">No hay semanas anteriores.</div>'}
    </main>`;
}

// --- Acceso directo en la pantalla de inicio del móvil ---

let eventoInstalar = null;
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  eventoInstalar = ev;
  render();
});

function yaInstalada() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function avisoOculto() {
  try { return localStorage.getItem('horarios-sin-aviso') === '1'; } catch { return false; }
}

function avisoInstalar() {
  if (!datos || yaInstalada() || avisoOculto()) return '';
  const esIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let como;
  if (eventoInstalar) como = '<button class="boton" data-instalar>Añadir a la pantalla de inicio</button>';
  else if (esIos) como = '<p>En Safari toca <b>Compartir</b> y luego <b>Añadir a pantalla de inicio</b>.</p>';
  else como = '<p>Abre el menú del navegador <b>⋮</b> y toca <b>Añadir a pantalla de inicio</b> o <b>Instalar app</b>.</p>';
  return `
    <div class="instalar">
      <div class="instalar-titulo">Tenla siempre a mano</div>
      <p>Añade esta web a tu móvil y ábrela como una app, sin instalar nada.</p>
      ${como}
      <button class="link-btn" data-ocultar-aviso>No mostrar más</button>
    </div>`;
}

function pantallaNoEncontrada() {
  return `${cabecera('No encontrado', '', '#/')}<main><div class="vacio">Esta página no existe.</div></main>`;
}

function render() {
  const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let html;
  if (!partes.length) html = pantallaInicio();
  else if (partes[0] === 'yo') html = pantallaPersona(partes[1]);
  else if (partes[0] === 'equipo') html = pantallaEquipo(partes[1]);
  else if (partes[0] === 'pasados') html = pantallaPasados();
  else html = pantallaNoEncontrada();
  app.innerHTML = html;
}

app.addEventListener('click', async (ev) => {
  if (ev.target.closest('[data-instalar]') && eventoInstalar) {
    eventoInstalar.prompt();
    await eventoInstalar.userChoice;
    eventoInstalar = null;
    return render();
  }
  if (ev.target.closest('[data-ocultar-aviso]')) {
    try { localStorage.setItem('horarios-sin-aviso', '1'); } catch { /* sin almacenamiento */ }
    return render();
  }
  const b = ev.target.closest('[data-area],[data-dia],[data-modo]');
  if (!b) return;
  if (b.dataset.area) equipo.area = b.dataset.area;
  if (b.dataset.dia) equipo.dia = Number(b.dataset.dia);
  if (b.dataset.modo) equipo.modo = b.dataset.modo;
  // Los enlaces cambian de pantalla ellos solos; los botones redibujan la actual.
  if (b.tagName === 'BUTTON') render();
});

window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#/equipo')) equipo.dia = null;
  render();
  window.scrollTo(0, 0);
});

async function iniciar() {
  try {
    const res = await fetch('data/horarios.json', { cache: 'no-cache' });
    datos = await res.json();
    render();
  } catch {
    if (datos) return; // Si ya había datos, se siguen mostrando.
    app.innerHTML = `${cabecera('Horarios')}<main><div class="vacio">No se pudieron cargar los horarios. Revisa tu conexión y recarga la página.</div></main>`;
  }
}

iniciar();

// Como app instalada puede quedar abierta días: al volver a ella se recargan los horarios.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') iniciar();
});
