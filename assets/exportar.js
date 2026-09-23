// Genera una imagen PNG del horario de un área, parecida a la tabla del Excel.
import { DIAS, DIAS_ABIERTOS, diasDe, diaDelMes, formatoHoras, formatoTramo, minutosSemana, rangoSemana } from './common.js';

const ESCALA = 2;
const FUENTE = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const COLOR = { marca: '#0a86ab', texto: '#1b2429', suave: '#5f6d74', libre: '#b3bdc2', borde: '#dde4e7', par: '#f2f5f6' };

export async function imagenArea(datos, lunes, area, nombreArea) {
  const empleados = datos.empleados[area];
  const semana = datos.semanas[lunes];
  const filas = empleados.map((e) => {
    const dias = diasDe(semana, e.id);
    return {
      nombre: e.nombre,
      celdas: DIAS_ABIERTOS.map((i) => dias[i].map(formatoTramo)),
      total: formatoHoras(minutosSemana(dias)),
    };
  });

  const medir = document.createElement('canvas').getContext('2d');
  const ancho = (texto, peso = 400, tam = 15) => {
    medir.font = `${peso} ${tam}px ${FUENTE}`;
    return medir.measureText(texto).width;
  };

  const pad = 14;
  const anchoNombre = Math.max(90, ...filas.map((f) => ancho(f.nombre, 600))) + pad * 2;
  const anchoDia = Math.max(
    120,
    ...DIAS_ABIERTOS.map((i) => ancho(`${DIAS[i]} ${diaDelMes(lunes, i)}`, 600)),
    ...filas.flatMap((f) => f.celdas.flat().map((t) => ancho(t))),
  ) + pad * 2;
  const anchoTotal = 80;
  const altoCab = 44;
  const altoFila = filas.some((f) => f.celdas.some((c) => c.length > 1)) ? 52 : 36;
  const margen = 24;
  const altoTitulo = 56;

  const W = margen * 2 + anchoNombre + anchoDia * DIAS_ABIERTOS.length + anchoTotal;
  const H = margen * 2 + altoTitulo + altoCab + altoFila * filas.length;

  const canvas = document.createElement('canvas');
  canvas.width = W * ESCALA;
  canvas.height = H * ESCALA;
  const c = canvas.getContext('2d');
  c.scale(ESCALA, ESCALA);
  c.fillStyle = '#fff';
  c.fillRect(0, 0, W, H);
  c.textBaseline = 'middle';

  const texto = (t, x, y, { peso = 400, tam = 15, color = COLOR.texto, alinear = 'center' } = {}) => {
    c.font = `${peso} ${tam}px ${FUENTE}`;
    c.fillStyle = color;
    c.textAlign = alinear;
    c.fillText(t, x, y);
  };

  texto(`HORARIO ${nombreArea.toUpperCase()}`, W / 2, margen + 16, { peso: 700, tam: 20 });
  texto(`Semana ${rangoSemana(lunes)}`, W / 2, margen + 40, { tam: 14, color: COLOR.suave });

  const x0 = margen;
  const y0 = margen + altoTitulo;
  const columnas = [anchoNombre, ...DIAS_ABIERTOS.map(() => anchoDia), anchoTotal];
  const xs = columnas.reduce((acc, w) => [...acc, acc.at(-1) + w], [x0]);

  c.fillStyle = COLOR.marca;
  c.fillRect(x0, y0, W - margen * 2, altoCab);
  DIAS_ABIERTOS.forEach((i, k) => {
    texto(`${DIAS[i]} ${diaDelMes(lunes, i)}`, xs[k + 1] + anchoDia / 2, y0 + altoCab / 2, { peso: 600, color: '#fff' });
  });
  texto('TOTAL', xs.at(-2) + anchoTotal / 2, y0 + altoCab / 2, { peso: 700, color: '#fff' });

  filas.forEach((f, r) => {
    const y = y0 + altoCab + r * altoFila;
    if (r % 2 === 1) {
      c.fillStyle = COLOR.par;
      c.fillRect(x0, y, W - margen * 2, altoFila);
    }
    const medio = y + altoFila / 2;
    texto(f.nombre, x0 + pad, medio, { peso: 600, alinear: 'left' });
    f.celdas.forEach((tramos, k) => {
      const cx = xs[k + 1] + anchoDia / 2;
      if (!tramos.length) texto('–', cx, medio, { color: COLOR.libre });
      else if (tramos.length === 1) texto(tramos[0], cx, medio);
      else {
        texto(tramos[0], cx, medio - 10);
        texto(tramos[1], cx, medio + 10);
      }
    });
    texto(f.total, xs.at(-2) + anchoTotal / 2, medio, { peso: 700 });
  });

  // Líneas verticales entre días, como en el Excel.
  c.strokeStyle = COLOR.borde;
  c.lineWidth = 1;
  xs.slice(1, -1).forEach((x) => {
    c.beginPath();
    c.moveTo(Math.round(x) + 0.5, y0 + altoCab);
    c.lineTo(Math.round(x) + 0.5, y0 + altoCab + altoFila * filas.length);
    c.stroke();
  });

  return new Promise((ok) => canvas.toBlob(ok, 'image/png'));
}

// En la tablet abre el menú de compartir (WhatsApp); si no, descarga el archivo.
export async function compartirImagen(blob, nombreArchivo) {
  const archivo = new File([blob], nombreArchivo, { type: 'image/png' });
  if (navigator.canShare?.({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo] });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
