// Utilidades compartidas entre la vista de empleados y el editor.

export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export const AREAS = [
  { id: 'sala', nombre: 'Sala' },
  { id: 'cocina', nombre: 'Cocina' },
];
// Lunes cerrado: el índice 0 nunca se edita ni se muestra con turnos.
export const DIAS_ABIERTOS = [1, 2, 3, 4, 5, 6];
// Las horas antes de esta se consideran de la madrugada del día siguiente.
const CORTE_MADRUGADA = 6 * 60;

export function aMinutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

// Minutos de un tramo; si el fin es menor o igual al inicio, cruza la medianoche.
export function duracionTramo([inicio, fin]) {
  let d = aMinutos(fin) - aMinutos(inicio);
  if (d <= 0) d += 24 * 60;
  return d;
}

export function minutosDia(tramos = []) {
  return tramos.reduce((s, t) => s + duracionTramo(t), 0);
}

export function minutosSemana(dias = []) {
  return dias.reduce((s, tramos) => s + minutosDia(tramos), 0);
}

export function formatoHoras(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function formatoTramo([inicio, fin]) {
  return `${inicio} – ${fin}`;
}

// Orden de horas de 09:00 a 02:00, en medias horas, para los selectores.
export function opcionesHora() {
  const out = [];
  for (let min = 9 * 60; min <= 26 * 60; min += 30) {
    const h = Math.floor(min / 60) % 24;
    out.push(`${String(h).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);
  }
  return out;
}

// Valor ordenable de una hora, tratando la madrugada como continuación del día.
export function ordenHora(hora) {
  const m = aMinutos(hora);
  return m < CORTE_MADRUGADA ? m + 24 * 60 : m;
}

// --- Fechas (siempre en hora local, formato YYYY-MM-DD) ---

export function parseFecha(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isoFecha(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function sumarDias(iso, n) {
  const d = parseFecha(iso);
  d.setDate(d.getDate() + n);
  return isoFecha(d);
}

export function lunesDe(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dow);
  return isoFecha(d);
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function fechaCorta(iso) {
  const d = parseFecha(iso);
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

export function rangoSemana(lunes) {
  return `${fechaCorta(lunes)} – ${fechaCorta(sumarDias(lunes, 6))}`;
}

export function diaDelMes(lunes, idx) {
  return parseFecha(sumarDias(lunes, idx)).getDate();
}

// Semana que ven los empleados: la más reciente que ya empezó.
export function semanaVigente(datos, hoy = new Date()) {
  const lunesHoy = lunesDe(hoy);
  const fechas = Object.keys(datos.semanas).filter((f) => f <= lunesHoy).sort();
  return fechas.at(-1) || null;
}

export function semanasPasadas(datos, vigente) {
  return Object.keys(datos.semanas).filter((f) => vigente && f < vigente).sort().reverse();
}

export function empleado(datos, id) {
  for (const area of AREAS) {
    const e = datos.empleados[area.id].find((x) => x.id === id);
    if (e) return { ...e, area: area.id };
  }
  return null;
}

export function diasDe(semana, id) {
  const dias = semana?.[id] || [];
  return Array.from({ length: 7 }, (_, i) => dias[i] || []);
}

export function escapar(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
