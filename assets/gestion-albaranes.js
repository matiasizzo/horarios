// Albaranes y facturas: lista, detalle, subida con lectura automática y revisión línea a línea.
import {
  estado, acciones, registrarVista, pintar, mostrar, guardas, api, $, esc, num, eur, fecha, fechaLarga, cant, precioTxt,
  plural, nombreMes, toast, ventana, hoyIso, albaranDe, porRevisar,
} from './gestion-base.js';
import {
  CATEGORIAS, UNIDADES_COMPRA, sumaLineas, gastoDe, reclamable, revisionAlbaran, mesDe, mismaEmpresa, normalizar, redondear,
} from './gestion-comun.js';

let seleccionado = null;
let filtro = 'todos';
let busqueda = '';
let paginaDetalle = 0;

// --- Fotos: se guardan solo en este dispositivo (IndexedDB), nunca en el servidor ---

const fotosEnCache = new Map(); // id → [{ tipo, url, blob? }]

function bd() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open('gestion-fotos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fotos');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

async function operar(modo, hacer) {
  const base = await bd();
  return new Promise((ok, ko) => {
    const t = base.transaction('fotos', modo);
    const r = hacer(t.objectStore('fotos'));
    t.oncomplete = () => ok(r?.result);
    t.onerror = () => ko(t.error);
  });
}

async function guardarFotos(id, fotos) {
  const conBlob = fotos.filter((f) => f.blob);
  fotosEnCache.set(id, fotos);
  try {
    await operar('readwrite', (s) => s.put(conBlob.map(({ tipo, blob }) => ({ tipo, blob })), id));
  } catch { /* sin almacenamiento: la foto solo se ve mientras la página siga abierta */ }
}

async function fotosDe(a) {
  if (fotosEnCache.has(a.id)) return fotosEnCache.get(a.id);
  const fijas = (a.fotos || []).map((url) => ({ tipo: 'image/jpeg', url }));
  let guardadas = [];
  try {
    guardadas = ((await operar('readonly', (s) => s.get(a.id))) || []).map((f) => ({ ...f, url: URL.createObjectURL(f.blob) }));
  } catch { /* sin almacenamiento */ }
  const fotos = [...fijas, ...guardadas];
  fotosEnCache.set(a.id, fotos);
  return fotos;
}

async function borrarFotos(id) {
  fotosEnCache.delete(id);
  try { await operar('readwrite', (s) => s.delete(id)); } catch { /* nada que borrar */ }
}

function panelFotos(fotos, pagina, accion, pie) {
  if (!fotos.length) {
    return `<figure class="foto" style="margin:0"><div class="sin-foto">No hay foto en este dispositivo.<br>Compáralo con el papel.</div></figure>`;
  }
  const i = Math.min(pagina, fotos.length - 1);
  const f = fotos[i];
  const medio = f.tipo === 'application/pdf'
    ? `<iframe src="${f.url}" title="PDF del documento"></iframe><a class="abrir" href="${f.url}" target="_blank" rel="noopener">Abrir el PDF aparte</a>`
    : `<a href="${f.url}" target="_blank" rel="noopener" title="Abrir a tamaño completo"><img src="${f.url}" alt="Página ${i + 1} del documento"></a>`;
  const botones = fotos.length > 1
    ? `<div class="paginas">${fotos.map((_, n) => `<button type="button" data-accion="${accion}" data-pagina="${n}" aria-pressed="${n === i}">Pág. ${n + 1}</button>`).join('')}</div>` : '';
  return `<figure class="foto" style="margin:0">${medio}${botones}<figcaption>${pie}</figcaption></figure>`;
}

// --- Archivos: las fotos se reducen antes de enviarlas (Vercel no acepta más de 4,5 MB) ---

const LADO_MAX = 2000;
const MAX_PDF = 3 * 1024 * 1024;

function cargarImagen(file) {
  return new Promise((ok, ko) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => ok({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); ko(new Error(`No se puede abrir ${file.name}`)); };
    img.src = url;
  });
}

async function prepararArchivo(file) {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_PDF) throw new Error(`${file.name} pesa más de 3 MB`);
    return { tipo: 'application/pdf', blob: file, nombre: file.name, url: URL.createObjectURL(file) };
  }
  if (!file.type.startsWith('image/') && !/\.(heic|heif|jpe?g|png|webp)$/i.test(file.name)) throw new Error(`${file.name} no es una foto ni un PDF`);
  const { img, url } = await cargarImagen(file);
  const escala = Math.min(1, LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(img.naturalWidth * escala);
  lienzo.height = Math.round(img.naturalHeight * escala);
  lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
  URL.revokeObjectURL(url);
  const blob = await new Promise((ok) => lienzo.toBlob(ok, 'image/jpeg', 0.82));
  if (!blob) throw new Error(`No se pudo preparar ${file.name}`);
  return { tipo: 'image/jpeg', blob, nombre: file.name, url: URL.createObjectURL(blob) };
}

const aBase64 = (blob) => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1]);
  r.onerror = () => ko(r.error);
  r.readAsDataURL(blob);
});

async function leer(archivo) {
  const { borrador } = await api({ accion: 'leer', archivo: { tipo: archivo.tipo, datos: await aBase64(archivo.blob) } });
  return borrador;
}

// Varias páginas leídas por separado forman un solo documento: la cabecera de la primera y los totales de la última.
function unir(borradores) {
  const orden = borradores.every((b) => b.pagina) ? [...borradores].sort((x, y) => x.pagina - y.pagina) : borradores;
  const primero = (c) => orden.map((b) => b[c]).find((v) => v != null && v !== '');
  const ultimo = (c) => [...orden].reverse().map((b) => b[c]).find((v) => v != null && v !== '');
  const paginas = Math.max(...orden.map((b) => b.paginas || 0));
  return {
    tipo: primero('tipo') || 'albaran',
    proveedor: primero('proveedor') || '',
    nif: primero('nif') || '',
    categoria: primero('categoria') || 'Otros',
    numero: primero('numero') || '',
    fecha: primero('fecha') || '',
    pag: [orden.length, paginas || null],
    base: ultimo('base') ?? null,
    iva: ultimo('iva') ?? null,
    total: ultimo('total') ?? null,
    sumar: true,
    estado: 'pendiente',
    resuelta: false,
    notas: '',
    lineas: orden.flatMap((b) => b.lineas),
    avisos: orden.flatMap((b) => b.avisos || []),
    albaranesIncluidos: [...new Set(orden.flatMap((b) => b.albaranesIncluidos || []))],
    noEsCompra: orden.every((b) => b.esCompra === false),
    orden: orden.map((b) => borradores.indexOf(b)),
  };
}

const lineaVacia = () => ({ orig: '', ing: '', cant: null, ud: 'kg', precio: null, imp: null, iva: null, ne: false, nota: '' });
const documentoVacio = () => ({
  tipo: 'albaran', proveedor: '', nif: '', categoria: 'Otros', numero: '', fecha: hoyIso(), pag: [1, null],
  base: null, iva: null, total: null, sumar: true, estado: 'pendiente', resuelta: false, notas: '', lineas: [lineaVacia()],
});

// --- Subida ---

function abrirSubida() {
  const ia = estado.datos.ia;
  const archivos = [];
  let ocupado = false;
  const { velo, cerrar, forzarCierre } = ventana(`
    <h3 style="font-size:1.15rem">Subir albaranes o facturas</h3>
    <p class="bajada" style="margin:0">${ia
    ? 'Fotos (con la cámara o de la galería) o PDF. Se leen solos y después revisas lo leído contra el papel.'
    : 'La lectura automática está apagada: verás la foto al lado y rellenarás las líneas a mano.'}</p>
    <label class="soltar" style="display:block;cursor:pointer">
      <b>Elegir fotos o PDF</b><br><span class="ayuda">Puedes elegir varios a la vez</span><br>
      <input type="file" id="sub-archivo" accept="image/*,application/pdf" multiple>
    </label>
    <div class="archivos" id="sub-lista"></div>
    <div class="opciones" id="sub-modo" hidden>
      <label class="opcion"><input type="radio" name="modo" value="mismo" checked><span><b>Son páginas del mismo documento</b><small>Se juntan en un solo albarán y lo revisas ahora.</small></span></label>
      <label class="opcion"><input type="radio" name="modo" value="distintos"><span><b>Cada archivo es un documento distinto</b><small>Se leen y se guardan todos como "por revisar"; los repasas después en la lista.</small></span></label>
    </div>
    <p class="error-txt" id="sub-error" hidden></p>
    <div class="acciones" style="justify-content:flex-end">
      <button class="btn sec" data-cerrar>Cancelar</button>
      <button class="btn" id="sub-leer" disabled>${ia ? 'Leer' : 'Rellenar a mano'}</button>
    </div>`, { ancho: true, ocupado: () => ocupado });

  const lista = $('#sub-lista', velo);
  const error = (t) => { $('#sub-error', velo).hidden = !t; $('#sub-error', velo).textContent = t || ''; };
  const modo = () => (archivos.length > 1 && ia ? velo.querySelector('input[name="modo"]:checked').value : 'mismo');

  function pintarLista(estados = {}) {
    lista.innerHTML = archivos.map((a, i) => {
      const e = estados[i];
      return `<div class="archivo">
        ${a.tipo === 'application/pdf' ? '<span class="pdf">PDF</span>' : `<img src="${a.url}" alt="">`}
        <span><span class="nombre">${esc(a.nombre)}</span><span class="det">${e ? e.html : `${num(a.blob.size / 1024, 0)} KB`}</span></span>
        ${e?.boton || (ocupado ? '' : `<button class="btn sec peq" data-quitar="${i}" aria-label="Quitar">✕</button>`)}
      </div>`;
    }).join('');
    $('#sub-modo', velo).hidden = !(archivos.length > 1 && ia) || ocupado;
    $('#sub-leer', velo).disabled = !archivos.length || ocupado;
  }

  velo.addEventListener('click', (ev) => {
    const q = ev.target.closest('[data-quitar]');
    if (q && !ocupado) {
      archivos.splice(Number(q.dataset.quitar), 1);
      pintarLista();
    }
  });

  $('#sub-archivo', velo).addEventListener('change', async (ev) => {
    error('');
    const elegidos = [...ev.target.files];
    ev.target.value = '';
    $('#sub-leer', velo).disabled = true;
    for (const f of elegidos) {
      try { archivos.push(await prepararArchivo(f)); } catch (e) { error(e.message); }
    }
    pintarLista();
  });

  let aMano = !ia;
  $('#sub-leer', velo).addEventListener('click', async () => {
    error('');
    if (aMano) {
      forzarCierre();
      return abrirEditor({ a: documentoVacio(), fotos: archivos });
    }
    ocupado = true;
    const estados = {};
    const marcar = (i, html, boton = '') => { estados[i] = { html, boton }; pintarLista(estados); };
    archivos.forEach((_, i) => marcar(i, '<span class="girando"></span> Leyendo…'));
    $('#sub-leer', velo).textContent = 'Leyendo…';

    if (modo() === 'mismo') {
      const resultados = await Promise.allSettled(archivos.map(leer));
      ocupado = false;
      const buenos = resultados.map((r, i) => [r, i]).filter(([r]) => r.status === 'fulfilled');
      const fallos = resultados.map((r, i) => [r, i]).filter(([r]) => r.status === 'rejected');
      if (!buenos.length) {
        fallos.forEach(([r, i]) => marcar(i, `<span class="error-txt">${esc(r.reason.message)}</span>`));
        aMano = true;
        $('#sub-leer', velo).textContent = 'Rellenar a mano';
        $('#sub-leer', velo).disabled = false;
        return;
      }
      const doc = unir(buenos.map(([r]) => r.value));
      const fotos = doc.orden.map((n) => archivos[buenos[n][1]]).concat(fallos.map(([, i]) => archivos[i]));
      const avisos = fallos.map(([r, i]) => `No se pudo leer ${archivos[i].nombre}: ${r.reason.message}`);
      forzarCierre();
      return abrirEditor({ a: { ...doc, pag: [archivos.length, doc.pag[1]] }, fotos, avisosLectura: avisos });
    }

    // Documentos distintos: se leen de dos en dos y se guardan como "por revisar".
    let guardados = 0;
    const pendientes = archivos.map((a, i) => i);
    const borradores = {};
    async function trabajar() {
      while (pendientes.length) {
        const i = pendientes.shift();
        try {
          const b = unir([await leer(archivos[i])]);
          borradores[i] = b;
          if (b.noEsCompra) throw new Error('No parece un albarán ni una factura');
          if (!b.proveedor || !b.fecha) throw new Error(`No se leyó ${!b.proveedor ? 'el proveedor' : 'la fecha'}`);
          marcar(i, '<span class="girando"></span> Guardando…');
          const r = await api({ accion: 'guardarAlbaran', albaran: { ...b, notas: b.avisos.join('\n') } });
          await guardarFotos(r.id, [archivos[i]]);
          guardados++;
          marcar(i, `<span class="estado bien">Guardado</span> ${esc(b.proveedor)} ${esc(b.numero)} · ${plural(b.lineas.length, 'línea', 'líneas')}`);
          pintar();
        } catch (e) {
          const repetido = e.codigo === 'repetido';
          marcar(i, repetido ? `<span class="estado neutro">Ya estaba subido</span> ${esc(e.message)}` : `<span class="error-txt">${esc(e.message)}</span>`,
            repetido ? '' : `<button class="btn sec peq" data-rellenar="${i}">Revisar a mano</button>`);
        }
      }
    }
    await Promise.all([trabajar(), trabajar()]);
    ocupado = false;
    pintarLista(estados);
    $('#sub-leer', velo).hidden = true;
    velo.querySelector('[data-cerrar]').textContent = 'Cerrar';
    error('');
    if (guardados) toast(`${plural(guardados, 'documento guardado', 'documentos guardados')} para revisar`);
    velo.addEventListener('click', (ev) => {
      const r = ev.target.closest('[data-rellenar]');
      if (!r) return;
      const i = Number(r.dataset.rellenar);
      cerrar();
      abrirEditor({ a: borradores[i] ? { ...borradores[i], notas: '' } : documentoVacio(), fotos: [archivos[i]], avisosLectura: borradores[i]?.avisos || [] });
    });
  });
}

// --- Editor (revisión) ---

const numeroDe = (t) => {
  const s = String(t ?? '').trim().replace(/\s|€|%/g, '');
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : NaN;
};
const valorNum = (n) => (n == null || Number.isNaN(n) ? '' : String(n).replace('.', ','));

function abrirEditor({ a, fotos = [], avisosLectura = [] }) {
  const doc = JSON.parse(JSON.stringify(a));
  const avisos = [...avisosLectura, ...(doc.avisos || [])];
  delete doc.avisos;
  if (!doc.lineas.length) doc.lineas.push(lineaVacia());
  estado.editor = { a: doc, fotos, nuevasFotos: fotos.some((f) => f.blob && !f.guardada), avisos, pagina: 0, cambios: !doc.id };
  guardas.salir = () => !estado.editor?.cambios || confirm('Hay cambios sin guardar en el albarán. ¿Salir sin guardarlos?');
  mostrar('editor', { forzar: true });
}

async function editarAlbaran(id) {
  const a = albaranDe(id);
  const fotos = (await fotosDe(a)).map((f) => ({ ...f, guardada: true }));
  abrirEditor({ a, fotos });
  estado.editor.cambios = false;
}

function avisosEditor() {
  const { a, avisos } = estado.editor;
  const lista = [...avisos];
  if (a.noEsCompra) lista.unshift('El lector dice que esto no parece un albarán ni una factura.');
  const incluidos = (a.albaranesIncluidos || []).filter((n) => estado.datos.albaranes.some((x) => x.tipo === 'albaran' && mismaEmpresa(x.proveedor, a.proveedor) && normalizar(x.numero) === normalizar(n)));
  if (a.tipo === 'factura' && incluidos.length && a.sumar !== false) {
    lista.unshift(`Esta factura agrupa albaranes que ya están subidos (${incluidos.join(', ')}). Desmarca "Sumar al gasto" para no contarlos dos veces.`);
  }
  const repetido = !a.id && a.numero && estado.datos.albaranes.find((x) => x.tipo === a.tipo && mismaEmpresa(x.proveedor, a.proveedor) && normalizar(x.numero) === normalizar(a.numero));
  if (repetido) lista.unshift(`Ya hay ${a.tipo === 'factura' ? 'una factura' : 'un albarán'} ${repetido.numero} de ${repetido.proveedor} del ${fechaLarga(repetido.fecha)}.`);
  return lista;
}

function filaLinea(l, i) {
  const n = (col, valor, ancho) => `<input class="d" inputmode="decimal" data-linea="${i}" data-col="${col}" value="${esc(valorNum(valor))}" style="min-width:${ancho}px" aria-label="${col}">`;
  return `<tr class="${l.ne ? 'tachada' : ''}">
    <td><input class="orig" data-linea="${i}" data-col="orig" value="${esc(l.orig)}" style="min-width:150px" aria-label="Texto en el albarán"></td>
    <td><input data-linea="${i}" data-col="ing" value="${esc(l.ing)}" list="dl-ingredientes" style="min-width:170px" aria-label="Ingrediente"></td>
    <td>${n('cant', l.cant, 64)}</td>
    <td><select data-linea="${i}" data-col="ud" aria-label="Unidad">${UNIDADES_COMPRA.map((u) => `<option${u === l.ud ? ' selected' : ''}>${u}</option>`).join('')}</select></td>
    <td>${n('precio', l.precio, 70)}</td>
    <td>${n('imp', l.imp, 76)}</td>
    <td>${n('iva', l.iva, 44)}</td>
    <td style="text-align:center"><input type="checkbox" data-linea="${i}" data-col="ne"${l.ne ? ' checked' : ''} aria-label="No entregado" title="Cobrado pero no entregado"></td>
    <td><button type="button" class="quitar" data-accion="linea-quitar" data-i="${i}" aria-label="Quitar línea">×</button></td>
  </tr>`;
}

function pintarEditor() {
  const ed = estado.editor;
  const cont = $('#v-editor');
  if (!ed) { cont.innerHTML = ''; return; }
  const { a } = ed;
  const campo = (id, etiqueta, valor, extra = '') => `<div class="campo"><label for="ed-${id}">${etiqueta}</label><input id="ed-${id}" data-campo="${id}" value="${esc(valor ?? '')}" ${extra}></div>`;
  const numCampo = (id, etiqueta) => campo(id, etiqueta, valorNum(a[id]), 'inputmode="decimal" class="num"');
  const avisos = avisosEditor();
  cont.innerHTML = `
    <div class="titulo-vista">
      <div><h2>${a.id ? 'Editar' : 'Revisar'} ${a.tipo === 'factura' ? 'factura' : 'albarán'}</h2>
      <p>Comprueba cada línea con el papel: nombre, cantidad, precio e importe. Lo que corrijas se recuerda para el siguiente de este proveedor.</p></div>
      <span class="espacio"></span>
      <div class="acciones">
        <button class="btn sec" data-accion="editor-cancelar">Cancelar</button>
        <button class="btn sec" data-accion="editor-guardar" data-estado="pendiente">Guardar para revisar luego</button>
        <button class="btn" data-accion="editor-guardar" data-estado="revisado">✓ Guardar revisado</button>
      </div>
    </div>
    <p class="error-txt" id="ed-error" hidden></p>
    ${avisos.length ? `<div class="alertas">${avisos.map((t) => `<div class="alerta aviso"><span class="ico">!</span><span><span class="t">${esc(t)}</span></span><span></span></div>`).join('')}</div>` : ''}
    <div class="editor-cabecera">
      <div id="ed-fotos">${panelFotos(ed.fotos, ed.pagina, 'editor-pagina', 'La foto se guarda solo en este dispositivo. Púlsala para verla en grande.')}</div>
      <div class="tarjeta form-rejilla">
        <div class="campo"><label for="ed-tipo">Documento</label><select id="ed-tipo" data-campo="tipo"><option value="albaran"${a.tipo === 'albaran' ? ' selected' : ''}>Albarán</option><option value="factura"${a.tipo === 'factura' ? ' selected' : ''}>Factura</option></select></div>
        <div class="campo doble"><label for="ed-proveedor">Proveedor</label><input id="ed-proveedor" data-campo="proveedor" value="${esc(a.proveedor)}" list="dl-proveedores" autocomplete="off"></div>
        <div class="campo"><label for="ed-categoria">Categoría</label><select id="ed-categoria" data-campo="categoria">${CATEGORIAS.map((c) => `<option${c === a.categoria ? ' selected' : ''}>${c}</option>`).join('')}</select></div>
        ${campo('numero', 'Número', a.numero)}
        ${campo('fecha', 'Fecha', a.fecha, 'type="date"')}
        ${campo('nif', 'NIF del proveedor', a.nif)}
        <div class="campo"><label for="ed-pag0">Páginas</label><div class="dos-campos"><input id="ed-pag0" data-campo="pag0" inputmode="numeric" value="${a.pag[0]}" aria-label="Páginas subidas"><span>de</span><input data-campo="pag1" inputmode="numeric" value="${a.pag[1] ?? ''}" aria-label="Páginas que tiene" placeholder="?"></div></div>
        ${numCampo('base', 'Base imponible (sin IVA)')}
        ${numCampo('iva', 'IVA')}
        ${numCampo('total', 'Total')}
        <label class="chk entera"><input type="checkbox" data-campo="sumar"${a.sumar !== false ? ' checked' : ''}><span>Sumar al gasto<span class="ayuda" style="display:block">Desmárcalo si es una factura que agrupa albaranes ya subidos.</span></span></label>
        <div class="campo entera"><label for="ed-notas">Notas</label><textarea id="ed-notas" data-campo="notas" placeholder="Vencimiento, forma de pago, lo que haya que reclamar…">${esc(a.notas)}</textarea></div>
      </div>
    </div>
    <div style="display:grid;gap:12px;min-width:0">
      <div class="tabla-cont"><table class="tabla-edit">
        <thead><tr><th style="width:22%">En el papel</th><th style="width:30%">Ingrediente</th><th class="d">Cant.</th><th>Ud</th><th class="d">Precio</th><th class="d">Importe</th><th class="d">IVA %</th><th title="Cobrado pero no entregado">No entr.</th><th></th></tr></thead>
        <tbody id="ed-lineas">${a.lineas.map(filaLinea).join('')}</tbody>
      </table></div>
      <div class="acciones">
        <button class="btn sec peq" data-accion="linea-mas">＋ Añadir línea</button>
        ${estado.datos.ia ? '<label class="btn sec peq" style="cursor:pointer">＋ Leer otra página<input type="file" id="ed-mas" accept="image/*,application/pdf" multiple hidden></label>' : '<label class="btn sec peq" style="cursor:pointer">＋ Añadir foto<input type="file" id="ed-mas" accept="image/*,application/pdf" multiple hidden></label>'}
      </div>
      <div class="cuadre" id="ed-cuadre"></div>
    </div>`;
  pintarCuadre();
}

function pintarCuadre() {
  const { a } = estado.editor;
  const suma = sumaLineas(a);
  const partes = [`Suma de líneas <b class="num">${eur(suma)}</b>`];
  if (a.base != null) {
    const dif = redondear(suma - a.base);
    partes.unshift(Math.abs(dif) <= 0.05 ? '<span class="estado bien">Cuadra con la base</span>' : `<span class="estado aviso">No cuadra: ${dif > 0 ? '+' : ''}${eur(dif)}</span>`);
  } else {
    partes.unshift('<span class="estado neutro">Sin base para comprobar</span>');
  }
  if (a.base != null && a.iva != null && a.total != null) {
    partes.push(Math.abs(a.base + a.iva - a.total) <= 0.05 ? 'Base + IVA = total ✓' : '<span class="error-txt">Base + IVA no da el total</span>');
  }
  const r = reclamable(a);
  if (r) partes.push(`<span class="estado mal">A reclamar ${eur(r)} con IVA</span>`);
  $('#ed-cuadre').innerHTML = partes.join(' · ');
}

function proveedorConocido(nombre) {
  return estado.datos.proveedores.find((p) => mismaEmpresa(p.nombre, nombre));
}

function alEscribirEditor(ev) {
  const ed = estado.editor;
  if (!ed) return;
  const t = ev.target;
  if (t.id === 'ed-mas') return;
  const valor = t.type === 'checkbox' ? t.checked : t.value;
  if (t.dataset.campo) {
    const c = t.dataset.campo;
    if (['base', 'iva', 'total'].includes(c)) ed.a[c] = numeroDe(valor);
    else if (c === 'pag0') ed.a.pag[0] = Math.max(1, Math.round(numeroDe(valor) || 1));
    else if (c === 'pag1') ed.a.pag[1] = numeroDe(valor) ? Math.round(numeroDe(valor)) : null;
    else ed.a[c] = valor;
    if (c === 'proveedor' && ev.type === 'change') {
      const p = proveedorConocido(valor);
      if (p) {
        ed.a.categoria = p.categoria;
        if (!ed.a.nif && p.nif) ed.a.nif = p.nif;
        $('#ed-categoria').value = p.categoria;
        $('#ed-nif').value = ed.a.nif;
      }
    }
  } else if (t.dataset.linea) {
    const l = ed.a.lineas[Number(t.dataset.linea)];
    const c = t.dataset.col;
    if (['cant', 'precio', 'imp', 'iva'].includes(c)) l[c] = numeroDe(valor);
    else l[c] = valor;
    if (c === 'ne') t.closest('tr').classList.toggle('tachada', valor);
  } else {
    return;
  }
  ed.cambios = true;
  pintarCuadre();
}

async function leerMasPaginas(ev) {
  const ed = estado.editor;
  const elegidos = [...ev.target.files];
  ev.target.value = '';
  if (!elegidos.length) return;
  const error = $('#ed-error');
  error.hidden = true;
  const nuevos = [];
  for (const f of elegidos) {
    try { nuevos.push(await prepararArchivo(f)); } catch (e) { error.hidden = false; error.textContent = e.message; }
  }
  if (!nuevos.length) return;
  ed.fotos.push(...nuevos);
  ed.nuevasFotos = true;
  ed.cambios = true;
  ed.a.pag[0] = ed.fotos.length;
  if (!estado.datos.ia) return pintarEditor();
  toast('Leyendo la página nueva…');
  const resultados = await Promise.allSettled(nuevos.map(leer));
  for (const r of resultados) {
    if (r.status === 'rejected') { ed.avisos.push(`No se pudo leer una página: ${r.reason.message}`); continue; }
    const b = r.value;
    if (ed.a.lineas.length === 1 && !ed.a.lineas[0].ing && !ed.a.lineas[0].imp) ed.a.lineas = [];
    ed.a.lineas.push(...b.lineas);
    for (const c of ['proveedor', 'nif', 'numero', 'fecha']) if (!ed.a[c] && b[c]) ed.a[c] = b[c];
    for (const c of ['base', 'iva', 'total']) if (b[c] != null) ed.a[c] = b[c];
    if (b.paginas) ed.a.pag[1] = Math.max(b.paginas, ed.a.pag[0]);
    ed.avisos.push(...(b.avisos || []));
  }
  pintarEditor();
}

async function guardarEditor(boton) {
  const ed = estado.editor;
  const error = $('#ed-error');
  const fallo = (t) => { error.hidden = false; error.textContent = t; error.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  error.hidden = true;
  const a = { ...ed.a, estado: boton.dataset.estado };
  a.lineas = a.lineas.filter((l) => l.ing || l.orig || l.imp != null);
  if (!a.proveedor.trim()) return fallo('Falta el proveedor.');
  if (!a.fecha) return fallo('Falta la fecha.');
  if ([a.base, a.iva, a.total].some(Number.isNaN) || a.lineas.some((l) => [l.cant, l.precio, l.imp, l.iva].some(Number.isNaN))) {
    return fallo('Hay un número mal escrito. Usa solo cifras y una coma para los decimales.');
  }
  const sinIng = a.lineas.findIndex((l) => !l.ing && !l.orig);
  if (sinIng >= 0) return fallo(`A la línea ${sinIng + 1} le falta el ingrediente.`);
  document.querySelectorAll('#v-editor [data-accion="editor-guardar"]').forEach((b) => { b.disabled = true; });
  try {
    let r;
    try {
      r = await api({ accion: 'guardarAlbaran', albaran: a });
    } catch (e) {
      if (e.codigo !== 'repetido' || !confirm(`${e.message}\n\n¿Guardarlo igualmente?`)) throw e;
      r = await api({ accion: 'guardarAlbaran', albaran: a, repetidoOk: true });
    }
    if (ed.nuevasFotos) await guardarFotos(r.id, ed.fotos);
    estado.editor = null;
    guardas.salir = null;
    seleccionado = r.id;
    paginaDetalle = 0;
    mostrar('albaranes', { forzar: true });
    toast(a.estado === 'revisado' ? 'Guardado y revisado' : 'Guardado para revisar luego');
  } catch (e) {
    fallo(e.message);
  } finally {
    document.querySelectorAll('#v-editor [data-accion="editor-guardar"]').forEach((b) => { b.disabled = false; });
  }
}

// --- Lista y detalle ---

function etiquetas(a) {
  const e = [a.estado === 'revisado' ? '<span class="estado bien">Revisado</span>' : '<span class="estado neutro">Por revisar</span>'];
  for (const r of revisionAlbaran(a)) {
    if (r.tipo === 'reclamar') e.push('<span class="estado mal">Reclamar</span>');
    if (r.tipo === 'paginas') e.push('<span class="estado aviso">Falta página</span>');
    if (r.tipo === 'cuadre') e.push('<span class="estado aviso">No cuadra</span>');
  }
  return [...new Set(e)].join(' ');
}

function filtrados() {
  const q = normalizar(busqueda);
  return estado.datos.albaranes.filter((a) => {
    if (filtro === 'pendientes' && a.estado === 'revisado') return false;
    if (filtro === 'incidencias' && !revisionAlbaran(a).length) return false;
    if (q && !normalizar(`${a.proveedor} ${a.numero} ${a.lineas.map((l) => l.ing).join(' ')}`).includes(q)) return false;
    return true;
  });
}

function pintarAlbaranes() {
  const d = estado.datos;
  const cont = $('#v-albaranes');
  const lista = filtrados();
  if (seleccionado && !albaranDe(seleccionado)) seleccionado = null;
  if (!seleccionado && lista.length) seleccionado = lista[0].id;
  const conIncidencias = d.albaranes.filter((a) => revisionAlbaran(a).length).length;
  const porMes = new Map();
  for (const a of lista) {
    const m = mesDe(a.fecha);
    if (!porMes.has(m)) porMes.set(m, []);
    porMes.get(m).push(a);
  }
  const filas = [...porMes.entries()].map(([m, docs]) => `
    <tr class="grupo"><td colspan="7">${nombreMes(m)} · ${plural(docs.length, 'documento', 'documentos')} · ${eur(docs.reduce((s, a) => s + gastoDe(a), 0))} sin IVA</td></tr>
    ${docs.map((a) => `<tr class="clic" data-albaran="${a.id}" aria-selected="${a.id === seleccionado}">
      <td class="num">${fecha(a.fecha)}</td>
      <td><b>${esc(a.proveedor)}</b>${a.sumar === false ? ' <span class="estado neutro" title="No suma al gasto">No suma</span>' : ''}</td>
      <td>${a.tipo === 'factura' ? 'Factura' : 'Albarán'} <span class="num">${esc(a.numero || '—')}</span></td>
      <td class="d opc">${a.lineas.length}</td>
      <td class="d">${a.base != null ? eur(a.base) : `<span title="Suma de líneas">${eur(sumaLineas(a))}*</span>`}</td>
      <td class="d opc">${a.total != null ? eur(a.total) : '—'}</td>
      <td>${etiquetas(a)}</td></tr>`).join('')}`).join('');

  cont.innerHTML = `
    <div class="titulo-vista">
      <div><h2>Albaranes y facturas</h2>
      <p>${d.ia ? 'Sube la foto o el PDF: se leen las líneas solas y aquí las revisas antes de darlas por buenas.' : 'Sube la foto o el PDF y rellena las líneas a mano mirando la foto.'}</p></div>
      <span class="espacio"></span>
      <div class="acciones">
        <button class="btn sec" data-accion="nuevo-a-mano">Añadir a mano</button>
        <button class="btn" data-accion="subir">＋ Subir fotos o PDF</button>
      </div>
    </div>
    ${d.ia ? '' : '<div class="alerta info"><span class="ico">i</span><span><b>La lectura automática está apagada</b><span class="t">Para que las líneas se rellenen solas hace falta la clave de Anthropic en Vercel (ANTHROPIC_API_KEY). Mientras tanto, todo funciona a mano.</span></span><span></span></div>'}
    <div class="filtros">
      ${[['todos', `Todos (${d.albaranes.length})`], ['pendientes', `Por revisar (${porRevisar().length})`], ['incidencias', `Con avisos (${conIncidencias})`]]
    .map(([id, t]) => `<button data-filtro-alb="${id}" aria-pressed="${filtro === id}">${t}</button>`).join('')}
      <span style="flex:1"></span>
      <input class="buscar" id="buscar-alb" placeholder="Buscar proveedor, número o producto" value="${esc(busqueda)}" aria-label="Buscar albaranes">
    </div>
    ${lista.length ? `<div class="tabla-cont"><table>
      <thead><tr><th>Fecha</th><th>Proveedor</th><th>Documento</th><th class="d opc">Líneas</th><th class="d">Base</th><th class="d opc">Total</th><th>Estado</th></tr></thead>
      <tbody>${filas}</tbody></table></div>
      <div class="tarjeta" id="detalle-albaran"></div>`
    : `<div class="tarjeta vacio"><b>${d.albaranes.length ? 'Ningún documento con ese filtro' : 'Todavía no hay albaranes'}</b>${d.albaranes.length ? '' : 'Pulsa "Subir fotos o PDF" para empezar.'}</div>`}`;
  if (lista.length) pintarDetalle();
}

async function pintarDetalle() {
  const a = albaranDe(seleccionado);
  const cont = $('#detalle-albaran');
  if (!a || !cont) return;
  const suma = sumaLineas(a);
  const avisos = revisionAlbaran(a);
  const r = reclamable(a);
  const conNe = a.lineas.some((l) => l.ne);
  cont.innerHTML = `
    <div class="titulo-vista" style="margin-bottom:12px">
      <div><h3 style="font-size:1.15rem">${esc(a.proveedor)} · ${a.tipo === 'factura' ? 'factura' : 'albarán'} ${esc(a.numero || 'sin número')}</h3>
        <p class="bajada" style="margin:2px 0 0">${fechaLarga(a.fecha)} · ${esc(a.categoria)}${a.nif ? ` · ${esc(a.nif)}` : ''} · ${a.pag[1] ? `${a.pag[0]} de ${a.pag[1]} páginas` : plural(a.pag[0], 'página', 'páginas')}${a.sumar === false ? ' · no suma al gasto' : ''}</p></div>
      <span class="espacio"></span>
      <div class="acciones">
        ${r ? '<button class="btn sec" data-accion="reclamar">Preparar reclamación</button>' : ''}
        ${conNe && !a.resuelta ? '<button class="btn sec" data-accion="resolver">Incidencia resuelta</button>' : ''}
        <button class="btn sec" data-accion="editar">Editar</button>
        <button class="btn" data-accion="marcar-revisado"${a.estado === 'revisado' ? ' data-volver="1"' : ''}>${a.estado === 'revisado' ? 'Volver a "por revisar"' : '✓ Dar por revisado'}</button>
      </div>
    </div>
    <div class="albaran">
      <div id="det-fotos"><div class="foto"><div class="sin-foto"><span class="girando"></span></div></div></div>
      <div style="display:grid;gap:12px;min-width:0">
        ${avisos.map((x) => `<div class="alerta ${x.tipo === 'reclamar' ? 'mal' : 'aviso'}"><span class="ico">!</span><span><span class="t">${esc(x.texto)}</span></span><span></span></div>`).join('')}
        ${a.resuelta && conNe ? '<div class="cuadre"><span class="estado bien">Incidencia resuelta</span></div>' : ''}
        ${a.notas ? `<div class="cuadre" style="white-space:pre-line">${esc(a.notas)}</div>` : ''}
        <div class="tabla-cont"><table>
          <thead><tr><th>En el albarán → ingrediente</th><th class="d">Cantidad</th><th class="d">Precio</th><th class="d">Importe</th><th class="d">IVA</th></tr></thead>
          <tbody>${a.lineas.map((l) => `
            <tr class="${l.ne ? 'tachada' : ''}">
              <td class="txt">${l.orig ? `<span class="orig">${esc(l.orig)}</span>` : ''}${esc(l.ing)}${l.ne ? ' <span class="estado mal">No entregado</span>' : ''}${l.nota ? `<span class="orig">${esc(l.nota)}</span>` : ''}</td>
              <td class="d">${l.cant != null ? `${cant(l.cant)} ${esc(l.ud)}` : '—'}</td>
              <td class="d">${l.precio != null ? precioTxt(l.precio) : '—'}</td>
              <td class="d">${l.imp != null ? eur(l.imp) : '—'}</td>
              <td class="d">${l.iva != null ? `${num(l.iva, 0)} %` : '—'}</td>
            </tr>`).join('')}</tbody>
          <tfoot><tr><td>Suma de líneas</td><td></td><td></td><td class="d">${eur(suma)}</td><td></td></tr></tfoot>
        </table></div>
        <div class="cuadre">
          <span>Base <b class="num">${a.base != null ? eur(a.base) : '—'}</b> · IVA <b class="num">${a.iva != null ? eur(a.iva) : '—'}</b> · Total <b class="num">${a.total != null ? eur(a.total) : '—'}</b></span>
          ${r ? `<span class="estado mal">A reclamar ${eur(r)} con IVA</span>` : ''}
        </div>
        <div class="acciones" style="justify-content:flex-end"><button class="btn peligro peq" data-accion="borrar-albaran">Borrar ${a.tipo === 'factura' ? 'factura' : 'albarán'}</button></div>
      </div>
    </div>`;
  const fotos = await fotosDe(a);
  if (seleccionado === a.id && $('#det-fotos')) {
    $('#det-fotos').innerHTML = panelFotos(fotos, paginaDetalle, 'detalle-pagina', fotos.length ? 'La foto está guardada en este dispositivo.' : '');
  }
}

function textoReclamacion(a) {
  const lineas = a.lineas.filter((l) => l.ne);
  const que = lineas.map((l) => `${l.cant != null ? `${cant(l.cant)} ${l.ud} de ` : ''}${l.ing}${l.imp != null ? ` (${eur(l.imp)} + IVA)` : ''}`).join(', ');
  const fechaTxt = new Date(`${a.fecha}T12:00:00`).toLocaleDateString('es-ES');
  return `Hola, en el ${a.tipo === 'factura' ? 'factura' : 'albarán'} ${a.numero} del ${fechaTxt} se cobra ${que}, que no se entregó. ¿Nos hacéis el abono? Gracias. Restaurante Morelia`;
}

export function verAlbaran(id) {
  seleccionado = id;
  paginaDetalle = 0;
  filtro = 'todos';
  busqueda = '';
  mostrar('albaranes');
  $('#detalle-albaran')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

export const abrirSubidaAlbaranes = abrirSubida;

Object.assign(acciones, {
  subir: () => abrirSubida(),
  'nuevo-a-mano': () => abrirEditor({ a: documentoVacio() }),
  editar: () => editarAlbaran(seleccionado),
  'editor-cancelar': () => {
    if (estado.editor?.cambios && !confirm('¿Descartar los cambios de este albarán?')) return;
    estado.editor = null;
    guardas.salir = null;
    mostrar('albaranes', { forzar: true });
  },
  'editor-guardar': (b) => guardarEditor(b),
  'editor-pagina': (b) => {
    estado.editor.pagina = Number(b.dataset.pagina);
    $('#ed-fotos').innerHTML = panelFotos(estado.editor.fotos, estado.editor.pagina, 'editor-pagina', 'La foto se guarda solo en este dispositivo.');
  },
  'detalle-pagina': async (b) => {
    paginaDetalle = Number(b.dataset.pagina);
    const fotos = await fotosDe(albaranDe(seleccionado));
    $('#det-fotos').innerHTML = panelFotos(fotos, paginaDetalle, 'detalle-pagina', 'La foto está guardada en este dispositivo.');
  },
  'linea-mas': () => {
    const ed = estado.editor;
    const ultima = ed.a.lineas.at(-1);
    ed.a.lineas.push({ ...lineaVacia(), ud: ultima?.ud || 'kg', iva: ultima?.iva ?? null });
    ed.cambios = true;
    $('#ed-lineas').innerHTML = ed.a.lineas.map(filaLinea).join('');
    $('#ed-lineas tr:last-child input[data-col="ing"]').focus();
  },
  'linea-quitar': (b) => {
    const ed = estado.editor;
    ed.a.lineas.splice(Number(b.dataset.i), 1);
    ed.cambios = true;
    $('#ed-lineas').innerHTML = ed.a.lineas.map(filaLinea).join('');
    pintarCuadre();
  },
  'marcar-revisado': async (b) => {
    b.disabled = true;
    try {
      await api({ accion: 'marcarAlbaran', id: seleccionado, estado: b.dataset.volver ? 'pendiente' : 'revisado' });
      // Al dar uno por revisado se pasa al siguiente pendiente, para ir repasando la pila.
      if (!b.dataset.volver && filtro === 'pendientes') seleccionado = null;
      pintar();
    } catch (e) { toast(e.message); b.disabled = false; }
  },
  resolver: async (b) => {
    b.disabled = true;
    try { await api({ accion: 'marcarAlbaran', id: seleccionado, resuelta: true }); pintar(); } catch (e) { toast(e.message); b.disabled = false; }
  },
  'borrar-albaran': async (b) => {
    const a = albaranDe(seleccionado);
    if (!confirm(`¿Borrar ${a.tipo === 'factura' ? 'la factura' : 'el albarán'} ${a.numero} de ${a.proveedor}? No se puede deshacer.`)) return;
    b.disabled = true;
    try {
      await api({ accion: 'borrarAlbaran', id: a.id });
      await borrarFotos(a.id);
      seleccionado = null;
      pintar();
      toast('Borrado');
    } catch (e) { toast(e.message); b.disabled = false; }
  },
  reclamar: () => {
    const a = albaranDe(seleccionado);
    const texto = textoReclamacion(a);
    const { velo } = ventana(`
      <h3 style="font-size:1.15rem">Reclamación a ${esc(a.proveedor)}</h3>
      <div class="campo"><label for="rec-texto">Mensaje para el comercial</label><textarea id="rec-texto" rows="5">${esc(texto)}</textarea></div>
      <div class="acciones" style="justify-content:flex-end">
        <button class="btn sec" data-cerrar>Cerrar</button>
        <a class="btn sec" id="rec-wa" href="https://wa.me/?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">WhatsApp</a>
        <button class="btn" id="rec-copiar">Copiar</button>
      </div>`);
    const area = $('#rec-texto', velo);
    area.addEventListener('input', () => { $('#rec-wa', velo).href = `https://wa.me/?text=${encodeURIComponent(area.value)}`; });
    $('#rec-copiar', velo).addEventListener('click', async (ev) => {
      try { await navigator.clipboard.writeText(area.value); ev.target.textContent = 'Copiado ✓'; } catch { area.select(); }
    });
  },
});

registrarVista('albaranes', pintarAlbaranes);
registrarVista('editor', pintarEditor);

// Eventos propios de la sección (los botones con data-accion los reparte gestion.js).
export function iniciarAlbaranes() {
  const lista = $('#v-albaranes');
  lista.addEventListener('click', (ev) => {
    const f = ev.target.closest('[data-filtro-alb]');
    if (f) { filtro = f.dataset.filtroAlb; seleccionado = null; return pintarAlbaranes(); }
    const fila = ev.target.closest('[data-albaran]');
    if (fila) {
      seleccionado = fila.dataset.albaran;
      paginaDetalle = 0;
      lista.querySelectorAll('[data-albaran]').forEach((tr) => tr.setAttribute('aria-selected', String(tr.dataset.albaran === seleccionado)));
      pintarDetalle();
      if (window.innerWidth < 980) $('#detalle-albaran').scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  });
  lista.addEventListener('input', (ev) => {
    if (ev.target.id !== 'buscar-alb') return;
    busqueda = ev.target.value;
    const pos = ev.target.selectionStart;
    seleccionado = null;
    pintarAlbaranes();
    const el = $('#buscar-alb');
    el.focus();
    el.setSelectionRange(pos, pos);
  });
  const editor = $('#v-editor');
  editor.addEventListener('input', alEscribirEditor);
  editor.addEventListener('change', (ev) => {
    if (ev.target.id === 'ed-mas') return leerMasPaginas(ev);
    alEscribirEditor(ev);
    if (ev.target.dataset.campo === 'tipo' || ev.target.dataset.campo === 'sumar' || ev.target.dataset.campo === 'proveedor' || ev.target.dataset.campo === 'numero') {
      // Los avisos de factura repetida o que agrupa albaranes dependen de estos campos.
      const foco = document.activeElement?.id;
      pintarEditor();
      if (foco) document.getElementById(foco)?.focus();
    }
  });
  window.addEventListener('beforeunload', (ev) => {
    if (estado.editor?.cambios) ev.preventDefault();
  });
}
