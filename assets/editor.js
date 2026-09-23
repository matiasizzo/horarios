// Editor de horarios (solo administrador, con PIN).
import {
  AREAS, DIAS, DIAS_CORTOS, DIAS_ABIERTOS, diasDe, diaDelMes, escapar, formatoHoras, formatoTramo,
  lunesDe, minutosSemana, opcionesHora, ordenHora, parseFecha, rangoSemana, semanaVigente, sumarDias,
} from './common.js';
import { imagenArea, compartirImagen } from './exportar.js';

const app = document.getElementById('app');
const HORAS = opcionesHora();
const CLAVE_BORRADOR = 'horarios-borrador';
const CLAVE_PIN = 'horarios-pin';

const estado = {
  pin: null,
  datos: null,
  semana: null,
  area: 'sala',
  sucio: false,
  publicando: false,
  // Estado de los avisos de la semana seleccionada (null = cargando o no disponible).
  avisos: null,
  avisando: false,
};

// --- Almacenamiento local (puede fallar en modo privado) ---
const local = {
  leer(clave, donde = localStorage) {
    try { return donde.getItem(clave); } catch { return null; }
  },
  escribir(clave, valor, donde = localStorage) {
    try { donde.setItem(clave, valor); } catch { /* sin almacenamiento */ }
  },
  borrar(clave, donde = localStorage) {
    try { donde.removeItem(clave); } catch { /* sin almacenamiento */ }
  },
};

function toast(mensaje) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = mensaje;
  document.body.append(t);
  setTimeout(() => t.remove(), Math.max(3500, mensaje.length * 70));
}

async function api(ruta, cuerpo) {
  const res = await fetch(`/api/${ruta}`, {
    method: cuerpo ? 'POST' : 'GET',
    headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `Error ${res.status}`), { status: res.status });
  return json;
}

// --- PIN ---

function pantallaPin(error = '') {
  app.innerHTML = `
    <header class="cabecera"><div class="cabecera-fila"><h1>Editor de horarios</h1></div></header>
    <main>
      <form class="pin" id="form-pin">
        <p>Introduce el PIN de administrador</p>
        <input id="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus>
        <div class="error">${escapar(error)}</div>
        <button class="boton" style="width:100%">Entrar</button>
        <p><a class="link-btn" href="./">Ir a la vista de empleados</a></p>
      </form>
    </main>`;
  document.getElementById('form-pin').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pin = document.getElementById('pin').value.trim();
    const boton = ev.target.querySelector('button');
    boton.disabled = true;
    try {
      await api('pin', { pin });
      local.escribir(CLAVE_PIN, pin, sessionStorage);
      estado.pin = pin;
      await cargar();
    } catch (e) {
      pantallaPin(e.status === 401 ? 'PIN incorrecto' : `No se pudo comprobar el PIN: ${e.message}`);
    }
  });
}

// --- Carga de datos ---

async function cargar() {
  app.innerHTML = '<main><div class="vacio">Cargando…</div></main>';
  try {
    estado.datos = await api('datos');
  } catch {
    const res = await fetch('data/horarios.json', { cache: 'no-cache' });
    estado.datos = await res.json();
  }
  const borrador = local.leer(CLAVE_BORRADOR);
  if (borrador) {
    try {
      const b = JSON.parse(borrador);
      if (JSON.stringify(b.datos) !== JSON.stringify(estado.datos)) {
        estado.datos = b.datos;
        estado.sucio = true;
        estado.semana = b.semana;
        toast('Se recuperaron cambios sin publicar');
      } else {
        local.borrar(CLAVE_BORRADOR);
      }
    } catch {
      local.borrar(CLAVE_BORRADOR);
    }
  }
  const fechas = Object.keys(estado.datos.semanas).sort();
  if (!estado.semana || !estado.datos.semanas[estado.semana]) {
    estado.semana = semanaVigente(estado.datos) || fechas.at(-1) || null;
  }
  render();
  cargarEstadoAvisos();
}

// --- Avisos a los empleados ---

async function cargarEstadoAvisos() {
  estado.avisos = null;
  if (!estado.semana) return render();
  const semana = estado.semana;
  try {
    const r = await api('avisos', { pin: estado.pin, accion: 'estado', semana });
    if (semana === estado.semana) estado.avisos = r;
  } catch (e) {
    if (semana === estado.semana) estado.avisos = { error: e.message };
  }
  render();
}

function panelAvisos() {
  const a = estado.avisos;
  if (!estado.semana) return '';
  let cuerpo;
  if (!a) cuerpo = '<span class="texto-suave">Cargando avisos…</span>';
  else if (a.error) {
    cuerpo = /no está publicada/.test(a.error)
      ? '<span class="texto-suave">Publica esta semana para poder avisar a los empleados.</span>'
      : `<span class="texto-suave">Avisos no disponibles: ${escapar(a.error)}</span>`;
  } else if (a.clavesMal) {
    cuerpo = `<span class="error-aviso">Las dos claves de Vercel no son pareja (probablemente se copiaron de dos ventanas distintas).
      Vuelve a “Configurar avisos”, copia <b>las dos</b> del mismo cuadro, haz Redeploy y activa de nuevo los avisos en los móviles.</span>
      <span class="espacio"></span>
      <button class="boton secundario" data-accion="configurar-avisos">Configurar avisos</button>`;
  } else if (!a.configurado) {
    cuerpo = `<span>Los avisos al móvil todavía no están configurados.</span>
      <span class="espacio"></span>
      <button class="boton secundario" data-accion="configurar-avisos">Configurar avisos</button>`;
  } else {
    const total = estado.datos.empleados.sala.length + estado.datos.empleados.cocina.length;
    const nombres = (ids) => ids.map((id) => [...estado.datos.empleados.sala, ...estado.datos.empleados.cocina]
      .find((e) => e.id === id)?.nombre).filter(Boolean).join(', ');
    const activos = `<span class="texto-suave">${a.suscritos.length} de ${total} con avisos activados</span>`;
    const bloqueo = estado.sucio ? 'disabled title="Publica los cambios antes de avisar"' : '';
    const ocupado = estado.avisando ? 'disabled' : '';
    let accion;
    if (!a.avisada) {
      accion = `<button class="boton" data-accion="avisar-todos" ${bloqueo} ${ocupado}>
        ${estado.avisando ? 'Enviando…' : 'Avisar a todos: horario listo'}</button>`;
    } else if (a.cambiados.length) {
      accion = `<span>Cambió el horario de <b>${escapar(nombres(a.cambiados))}</b></span>
        <button class="boton" data-accion="avisar-cambios" ${bloqueo} ${ocupado}>
        ${estado.avisando ? 'Enviando…' : `Avisar a ${a.cambiados.length === 1 ? 'esa persona' : `esas ${a.cambiados.length} personas`}`}</button>`;
    } else {
      accion = `<span class="ok">✓ Semana avisada, sin cambios desde el aviso</span>
        <button class="link-btn" data-accion="avisar-todos" ${bloqueo} ${ocupado}>Enviar de nuevo a todos</button>`;
    }
    const futura = estado.semana > lunesDe()
      ? `<div class="texto-suave nota">Los empleados verán esta semana en la app a partir del lunes ${diaDelMes(estado.semana, 0)}.</div>` : '';
    cuerpo = `${activos}<span class="espacio"></span>${accion}${futura}`;
  }
  return `<div class="panel-avisos"><b>Avisos</b>${cuerpo}</div>`;
}

async function avisar(solo) {
  const texto = solo === 'cambios'
    ? '¿Enviar el aviso de cambio solo a las personas a las que les cambió el horario?'
    : `¿Enviar a todos el aviso con su horario de la semana ${rangoSemana(estado.semana)}?`;
  if (!confirm(texto)) return;
  estado.avisando = true;
  render();
  try {
    const r = await api('avisos', { pin: estado.pin, accion: 'enviar', semana: estado.semana, solo });
    let msj = `Avisos enviados: ${r.enviados}.`;
    if (r.fallidos) msj += ` Fallaron ${r.fallidos} (${r.errores.join(' | ')}).`;
    if (r.sinAvisos.length) msj += ` Sin avisos activados: ${r.sinAvisos.join(', ')}.`;
    toast(msj);
  } catch (e) {
    toast(`No se pudieron enviar: ${e.message}`);
  }
  estado.avisando = false;
  cargarEstadoAvisos();
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Genera las claves en este dispositivo: la privada nunca pasa por ningún servidor ni chat.
async function abrirConfigurarAvisos() {
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publica = base64url(await crypto.subtle.exportKey('raw', par.publicKey));
  const privada = (await crypto.subtle.exportKey('jwk', par.privateKey)).d;
  const fondo = document.createElement('div');
  fondo.className = 'hoja-fondo';
  const campo = (nombre, valor) => `
    <div class="etq">${nombre}</div>
    <div class="copiar"><input readonly value="${valor}"><button class="boton secundario" data-copiar="${valor}">Copiar</button></div>`;
  fondo.innerHTML = `
    <div class="hoja" role="dialog" aria-label="Configurar avisos" style="max-width:560px">
      <h3>Configurar avisos</h3>
      <div class="sub">Añade estas dos variables en Vercel → tu proyecto → Settings → Environment Variables, y luego haz <b>Redeploy</b>.</div>
      ${campo('VAPID_PUBLIC_KEY', publica)}
      ${campo('VAPID_PRIVATE_KEY', privada)}
      <p class="texto-suave">La clave privada es secreta: no la compartas. Si la cambias más adelante, cada empleado tendrá que volver a activar los avisos.</p>
      <div class="fila-botones"><button class="boton" data-cerrar>Listo</button></div>
    </div>`;
  fondo.addEventListener('click', async (ev) => {
    if (ev.target === fondo || ev.target.closest('[data-cerrar]')) return fondo.remove();
    const b = ev.target.closest('[data-copiar]');
    if (b) {
      try {
        await navigator.clipboard.writeText(b.dataset.copiar);
        b.textContent = 'Copiada';
      } catch {
        b.previousElementSibling.select();
      }
    }
  });
  document.body.append(fondo);
}

function marcarCambio() {
  estado.sucio = true;
  local.escribir(CLAVE_BORRADOR, JSON.stringify({ datos: estado.datos, semana: estado.semana }));
}

// --- Pantalla principal ---

function etiquetaSemana(fecha) {
  const vigente = semanaVigente(estado.datos);
  const lunesHoy = lunesDe();
  let extra = '';
  if (fecha === vigente) extra = ' · en curso';
  else if (fecha > lunesHoy) extra = ' · próxima';
  return `Semana ${rangoSemana(fecha)}${extra}`;
}

function tablaEditor() {
  const semana = estado.datos.semanas[estado.semana];
  const encabezado = DIAS_ABIERTOS.map((i) => `<th>${DIAS_CORTOS[i]} ${diaDelMes(estado.semana, i)}</th>`).join('');
  const filas = estado.datos.empleados[estado.area].map((e) => {
    const dias = diasDe(semana, e.id);
    const celdas = DIAS_ABIERTOS.map((i) => {
      const tramos = dias[i];
      return `<td class="celda ${tramos.length ? '' : 'vacia'}" data-emp="${e.id}" data-dia="${i}">
        ${tramos.length ? tramos.map(formatoTramo).join('<br>') : '+'}</td>`;
    }).join('');
    return `<tr><td class="nom">${escapar(e.nombre)}</td>${celdas}<td class="tot">${formatoHoras(minutosSemana(dias))}</td></tr>`;
  }).join('');
  return `<div class="tabla-scroll"><table class="semana editor">
    <thead><tr><th class="nom"></th>${encabezado}<th>Total</th></tr></thead>
    <tbody>${filas}</tbody></table></div>`;
}

function render() {
  const fechas = Object.keys(estado.datos.semanas).sort().reverse();
  const opciones = fechas.map((f) => `<option value="${f}" ${f === estado.semana ? 'selected' : ''}>${etiquetaSemana(f)}</option>`).join('');
  const pestanas = AREAS.map((a) => `<button data-area="${a.id}" aria-pressed="${estado.area === a.id}">${a.nombre}</button>`).join('');

  app.innerHTML = `
    <header class="cabecera"><div class="cabecera-fila">
      <h1>Editor de horarios</h1>
      <span class="estado ${estado.sucio ? 'sucio' : ''}">${estado.sucio ? 'Cambios sin publicar' : 'Publicado'}</span>
    </div></header>
    <main class="ancho">
      <div class="barra">
        ${fechas.length ? `<select id="semana">${opciones}</select>` : ''}
        <button class="boton secundario" data-accion="nueva">+ Nueva semana</button>
        <span class="espacio"></span>
        <button class="boton" data-accion="publicar" ${estado.sucio && !estado.publicando ? '' : 'disabled'}>
          ${estado.publicando ? 'Publicando…' : 'Publicar'}
        </button>
      </div>
      ${estado.semana ? `
        ${panelAvisos()}
        <div class="barra">
          <div class="pestanas">${pestanas}</div>
          <span class="espacio"></span>
          <button class="boton secundario" data-accion="imagen">Compartir imagen</button>
          <button class="boton peligro" data-accion="borrar">Borrar semana</button>
        </div>
        ${tablaEditor()}
        <p class="pie">Toca una celda para cambiar el horario. Los cambios se ven en la app cuando pulsas <b>Publicar</b>.</p>
      ` : '<div class="vacio">No hay semanas. Crea la primera con “Nueva semana”.</div>'}
      <p class="pie"><a class="link-btn" href="./" target="_blank">Abrir la vista de empleados</a></p>
    </main>`;
}

// --- Hoja para editar una celda ---

function selectHora(valor, clase) {
  return `<select class="${clase}">${HORAS.map((h) => `<option ${h === valor ? 'selected' : ''}>${h}</option>`).join('')}</select>`;
}

function tramoPorDefecto(dia, anterior) {
  if (anterior) return ['20:00', '23:30'];
  return dia <= 2 ? ['19:00', '23:30'] : ['12:00', '16:00'];
}

function abrirCelda(idEmp, dia) {
  const emp = estado.datos.empleados[estado.area].find((e) => e.id === idEmp);
  const semana = estado.datos.semanas[estado.semana];
  let tramos = diasDe(semana, idEmp)[dia].map((t) => [...t]);
  if (!tramos.length) tramos = [tramoPorDefecto(dia)];

  const fondo = document.createElement('div');
  fondo.className = 'hoja-fondo';
  const dibujar = (error = '') => {
    fondo.innerHTML = `
      <div class="hoja" role="dialog" aria-label="Editar horario">
        <h3>${escapar(emp.nombre)}</h3>
        <div class="sub">${DIAS[dia]} ${diaDelMes(estado.semana, dia)}</div>
        ${tramos.map((t, k) => `
          <div class="etq">${tramos.length > 1 ? `Tramo ${k + 1}` : 'Horario'}</div>
          <div class="tramo-edit" data-k="${k}">
            ${selectHora(t[0], 'ini')}<span>a</span>${selectHora(t[1], 'fin')}
            ${tramos.length > 1 ? `<button class="quitar" data-quitar="${k}" aria-label="Quitar tramo">✕</button>` : ''}
          </div>`).join('')}
        ${tramos.length < 2 ? '<button class="link-btn" data-hoja="partido">+ Añadir segundo tramo (turno partido)</button>' : ''}
        <div class="error">${escapar(error)}</div>
        <div class="fila-botones">
          <button class="boton peligro" data-hoja="libre">Libre</button>
          <button class="boton secundario" data-hoja="cancelar">Cancelar</button>
          <button class="boton" data-hoja="guardar">Guardar</button>
        </div>
      </div>`;
  };
  const leerSelects = () => {
    fondo.querySelectorAll('.tramo-edit').forEach((fila) => {
      const k = Number(fila.dataset.k);
      tramos[k] = [fila.querySelector('.ini').value, fila.querySelector('.fin').value];
    });
  };
  const guardar = (nuevos) => {
    const dias = diasDe(semana, idEmp);
    dias[dia] = nuevos;
    semana[idEmp] = dias;
    marcarCambio();
    fondo.remove();
    render();
  };

  fondo.addEventListener('click', (ev) => {
    if (ev.target === fondo) return fondo.remove();
    const b = ev.target.closest('button');
    if (!b) return;
    leerSelects();
    if (b.dataset.quitar) {
      tramos.splice(Number(b.dataset.quitar), 1);
      return dibujar();
    }
    const accion = b.dataset.hoja;
    if (accion === 'cancelar') return fondo.remove();
    if (accion === 'libre') return guardar([]);
    if (accion === 'partido') {
      tramos.push(tramoPorDefecto(dia, tramos[0]));
      return dibujar();
    }
    if (accion === 'guardar') {
      const error = validarTramos(tramos);
      if (error) return dibujar(error);
      guardar(tramos);
    }
  });
  dibujar();
  document.body.append(fondo);
}

function validarTramos(tramos) {
  for (const [ini, fin] of tramos) {
    if (ordenHora(fin) <= ordenHora(ini)) return 'La hora de fin tiene que ser posterior a la de inicio.';
  }
  if (tramos.length === 2 && ordenHora(tramos[1][0]) < ordenHora(tramos[0][1])) {
    return 'El segundo tramo tiene que empezar después de que termine el primero.';
  }
  return null;
}

// --- Nueva semana ---

function abrirNuevaSemana() {
  const fechas = Object.keys(estado.datos.semanas).sort();
  const ultima = fechas.at(-1);
  const sugerida = ultima ? sumarDias(ultima, 7) : lunesDe();
  const fondo = document.createElement('div');
  fondo.className = 'hoja-fondo';
  fondo.innerHTML = `
    <div class="hoja" role="dialog" aria-label="Nueva semana">
      <h3>Nueva semana</h3>
      <div class="sub">Elige el lunes con el que empieza.</div>
      <input type="date" id="nueva-fecha" value="${sugerida}" step="7">
      <div class="etq">Empezar con</div>
      <select class="completo" id="nueva-base">
        ${fechas.slice().reverse().map((f) => `<option value="${f}">Copia de la semana ${rangoSemana(f)}</option>`).join('')}
        <option value="">Semana vacía</option>
      </select>
      <div class="error"></div>
      <div class="fila-botones">
        <button class="boton secundario" data-n="cancelar">Cancelar</button>
        <button class="boton" data-n="crear">Crear</button>
      </div>
    </div>`;
  fondo.addEventListener('click', (ev) => {
    if (ev.target === fondo) return fondo.remove();
    const accion = ev.target.closest('button')?.dataset.n;
    if (accion === 'cancelar') return fondo.remove();
    if (accion !== 'crear') return;
    const fecha = fondo.querySelector('#nueva-fecha').value;
    const base = fondo.querySelector('#nueva-base').value;
    const error = fondo.querySelector('.error');
    if (!fecha) return (error.textContent = 'Elige una fecha.');
    if (parseFecha(fecha).getDay() !== 1) return (error.textContent = 'La fecha tiene que ser un lunes.');
    if (estado.datos.semanas[fecha]) return (error.textContent = 'Esa semana ya existe.');
    estado.datos.semanas[fecha] = base ? structuredClone(estado.datos.semanas[base]) : {};
    estado.semana = fecha;
    marcarCambio();
    fondo.remove();
    render();
  });
  document.body.append(fondo);
}

// --- Publicar, borrar e imagen ---

async function publicar() {
  estado.publicando = true;
  render();
  try {
    await api('publicar', { pin: estado.pin, datos: estado.datos, semana: estado.semana });
    estado.sucio = false;
    local.borrar(CLAVE_BORRADOR);
    toast('Publicado. Los empleados lo verán en 1 o 2 minutos.');
    cargarEstadoAvisos();
  } catch (e) {
    if (e.status === 401) {
      local.borrar(CLAVE_PIN, sessionStorage);
      estado.publicando = false;
      return pantallaPin('El PIN ya no es válido. Tus cambios se guardaron en este dispositivo.');
    }
    toast(`No se pudo publicar: ${e.message}`);
  }
  estado.publicando = false;
  render();
}

function borrarSemana() {
  if (!confirm(`¿Borrar la semana ${rangoSemana(estado.semana)}? Se borra para todos al publicar.`)) return;
  delete estado.datos.semanas[estado.semana];
  estado.semana = Object.keys(estado.datos.semanas).sort().at(-1) || null;
  marcarCambio();
  render();
}

async function imagen() {
  const area = AREAS.find((a) => a.id === estado.area);
  const blob = await imagenArea(estado.datos, estado.semana, area.id, area.nombre);
  await compartirImagen(blob, `horario-${area.id}-${estado.semana}.png`);
}

app.addEventListener('click', (ev) => {
  const celda = ev.target.closest('td.celda');
  if (celda) return abrirCelda(celda.dataset.emp, Number(celda.dataset.dia));
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.area) {
    estado.area = b.dataset.area;
    return render();
  }
  const acciones = {
    nueva: abrirNuevaSemana,
    publicar,
    borrar: borrarSemana,
    imagen,
    'configurar-avisos': abrirConfigurarAvisos,
    'avisar-todos': () => avisar('todos'),
    'avisar-cambios': () => avisar('cambios'),
  };
  acciones[b.dataset.accion]?.();
});

app.addEventListener('change', (ev) => {
  if (ev.target.id === 'semana') {
    estado.semana = ev.target.value;
    render();
    cargarEstadoAvisos();
  }
});

window.addEventListener('beforeunload', (ev) => {
  if (estado.sucio) ev.preventDefault();
});

const pinGuardado = local.leer(CLAVE_PIN, sessionStorage);
if (pinGuardado) {
  estado.pin = pinGuardado;
  cargar();
} else {
  pantallaPin();
}
