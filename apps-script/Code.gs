/**
 * MULTIPAR S.A. — Puente Guardia_proyecto
 * Lee el Excel "A - GUARDIA 2026" (Google Sheet) y expone su contenido
 * como JSON público de solo lectura, para que la web estática en
 * GitHub Pages (Guardia_proyecto) lo consuma con fetch().
 *
 * INSTALACIÓN:
 * (Sirve tanto si este script está atado a la planilla vía Extensiones → Apps Script,
 * como si es un proyecto independiente creado desde script.google.com — el código
 * abre la planilla por su ID directamente, así que funciona en ambos casos.)
 * 1. Pegar este archivo entero en Code.gs, reemplazando lo que haya.
 * 2. Implementar → Nueva implementación → tipo "Aplicación web".
 *    - Ejecutar como: Yo (tu cuenta)
 *    - Quién tiene acceso: Cualquier usuario (para que la web pública pueda leerlo)
 * 5. Copiar la URL que te da (".../exec") y pasársela a Claude para wirear el frontend.
 * 6. Cada vez que se edite el código hay que crear una "Nueva implementación"
 *    (o gestionar implementaciones → editar → nueva versión) para que los cambios se publiquen.
 * 7. IMPORTANTE — clave de acceso: ⚙️ (ícono de Configuración del proyecto, en el
 *    menú de la izquierda) → Propiedades del script → Agregar propiedad de script:
 *      Propiedad: CLAVE_ACCESO
 *      Valor: la misma contraseña que se usa para entrar a la web
 *    Esto NUNCA queda en GitHub — vive solo acá, dentro de tu cuenta de Google.
 */

// ─────────────────────────────────────────────────────────────
// PUNTO DE ENTRADA
// ─────────────────────────────────────────────────────────────
function doGet(e) {
  // ── Control de acceso ──
  // La clave real se guarda en Apps Script → Configuración del proyecto (⚙️)
  // → Propiedades del script → CLAVE_ACCESO. NUNCA se sube a GitHub así,
  // por eso vive acá y no en el HTML/JS público.
  var claveEsperada = PropertiesService.getScriptProperties().getProperty('CLAVE_ACCESO');
  var claveRecibida = (e.parameter.clave || '');
  if (claveEsperada && claveRecibida !== claveEsperada) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'No autorizado' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var ss = SpreadsheetApp.openById('1AVrjPPJtLW0Rqon-4B4kOI9on49Wo7b7h8TR2UOBndo');
  var data = {
    actualizado: new Date().toISOString(),
    turno: parseGuardia(ss.getSheetByName('GUARDIA')),
    previstos: []
      .concat(parseProgramacion(ss.getSheetByName('SUBIDAS'), 'subida'))
      .concat(parseProgramacion(ss.getSheetByName('BAJADAS'), 'bajada'))
      .concat(parseProgramacion(ss.getSheetByName('CAMPANA'), 'campana')),
    novedades: parseNovedades(ss.getSheetByName('NOVEDADES')),
    remises: parseRemises(ss.getSheetByName('GUARDIA REMISES')),
    transitos: parseTransitos(ss.getSheetByName('GUARDIA'))
  };
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────
// HELPERS GENERALES
// ─────────────────────────────────────────────────────────────
function s(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function fmtFecha(v) {
  // Puede venir como objeto Date (celda formateada como fecha) o como texto libre ("10-10:00")
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  }
  return s(v);
}

function fmtHora(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  }
  return s(v);
}

// ─────────────────────────────────────────────────────────────
// HOJA "GUARDIA" — roster de turno, francos, observaciones, enfermos
// ─────────────────────────────────────────────────────────────
function parseGuardia(sheet) {
  if (!sheet) return null;
  var vals = sheet.getDataRange().getValues();
  // vals es 0-indexed: vals[fila-1][columna-1]
  var col = function (letra) {
    // convierte letra de columna (A, B, ... AF) a índice 0-based
    var n = 0;
    for (var i = 0; i < letra.length; i++) {
      n = n * 26 + (letra.charCodeAt(i) - 64);
    }
    return n - 1;
  };
  var A=col('A'),B=col('B'),C=col('C'),E=col('E'),G=col('G'),H=col('H'),
      I=col('I'),L=col('L'),Q=col('Q'),S=col('S'),U=col('U'),Y=col('Y'),
      Z=col('Z'),AB=col('AB'),AD=col('AD'),AE=col('AE'),AF=col('AF');

  var result = {
    fecha: '', horaDesde: '', horaHasta: '',
    practicos: [],
    francos: [],
    enfermos: [],
    observaciones: [],
    telefonos: [],
    presidente: '', coordinador: ''
  };

  // Fila 2: FECHA: | fecha | horaDesde | A | horaHasta | fecha
  if (vals[1]) {
    result.fecha = fmtFecha(vals[1][col('V')] || vals[1][22]);
    result.horaDesde = fmtHora(vals[1][25]); // Y2 aprox — ver nota abajo si difiere
  }

  // ROSTER DE TURNO: filas 3 en adelante mientras haya nombre en columna C
  for (var r = 2; r < vals.length; r++) {
    var nombre = s(vals[r][C]);
    if (!nombre) {
      // cortar apenas se acaben las filas con nombre (evita agarrar basura más abajo)
      if (r > 3) break; else continue;
    }
    result.practicos.push({
      pos: s(vals[r][A]),
      cambio: s(vals[r][B]) === '*',
      nombre: nombre,
      tipo: s(vals[r][G]),
      detalle: s(vals[r][H]),
      destino: s(vals[r][L])
    });
  }

  // FRANCOS: anclado donde columna U dice "FRANCOS"
  var francosRow = -1, enfermosRow = -1;
  for (var r2 = 0; r2 < vals.length; r2++) {
    var uVal = s(vals[r2][U]).toUpperCase();
    var aVal = s(vals[r2][A]).toUpperCase();
    if (uVal === 'FRANCOS') francosRow = r2;
    if (uVal === 'ENFERMOS') enfermosRow = r2;
    if (aVal === 'OBSERVACIONES') {
      // recolectar observaciones en columna A/B hacia abajo hasta fila en blanco
      for (var r3 = r2 + 1; r3 < vals.length; r3++) {
        var texto = s(vals[r3][B]) || s(vals[r3][A]);
        if (!texto) continue;
        if (/^(PRESIDENTE|https?:\/\/|Desde este vinculo|CANAL M\. GARCIA|\d{2}\/\d{2}\/\d{2})/i.test(texto)) break;
        result.observaciones.push(texto);
      }
    }
    if (uVal.indexOf('TELEFONOS DE LAS LANCHAS') === 0) {
      for (var rt = r2 + 1; rt < vals.length; rt++) {
        var puerto = s(vals[rt][U]);
        if (!puerto) break;
        var tel = s(vals[rt][col('X')]);
        var telExtra = s(vals[rt][col('AB')]);
        result.telefonos.push({ puerto: puerto, telefono: tel + (telExtra ? ' / ' + telExtra : '') });
      }
    }
    if (s(vals[r2][B]).toUpperCase().indexOf('PRESIDENTE:') === 0) {
      result.presidente = s(vals[r2][B]).replace(/^PRESIDENTE:\s*/i, '');
    }
    if (s(vals[r2][U]).toUpperCase().indexOf('COORDINADOR:') === 0) {
      result.coordinador = s(vals[r2][U]).replace(/^COORDINADOR:\s*/i, '');
    }
  }

  if (francosRow >= 0) {
    for (var rf = francosRow + 1; rf < vals.length; rf++) {
      var nombreF = s(vals[rf][U]);
      if (!nombreF) break;
      result.francos.push({
        cambio: s(vals[rf][col('T')]) === '*',
        nombre: nombreF,
        nro: s(vals[rf][Y]),
        horaSalida: fmtHora(vals[rf][Z]),
        fechaSalida: fmtFecha(vals[rf][AB]),
        horaIngreso: fmtHora(vals[rf][AE]),
        fechaIngreso: fmtFecha(vals[rf][AF])
      });
    }
  }

  if (enfermosRow >= 0) {
    for (var re = enfermosRow + 1; re < vals.length; re++) {
      var nombreE = s(vals[re][U]);
      if (!nombreE) break;
      result.enfermos.push({
        nombre: nombreE,
        nro: s(vals[re][Y]),
        hora: fmtHora(vals[re][Z]),
        fecha: fmtFecha(vals[re][AB])
      });
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// HOJAS "SUBIDAS" / "BAJADAS" / "CAMPANA" — programación de buques
// Formato tabular limpio compartido entre las 3 hojas:
// col A: marca (X/*), B: agencia/práctico, C: buque, D: coef,
// E/F: fecha/hora recalada, G/H: fecha/hora confirmado (Z.C.),
// I: desde, J: hasta, K: observaciones
// ─────────────────────────────────────────────────────────────
function parseProgramacion(sheet, tipo) {
  if (!sheet) return [];
  var vals = sheet.getDataRange().getValues();
  var out = [];
  for (var r = 0; r < vals.length; r++) {
    var buque = s(vals[r][2]); // columna C
    var coef = vals[r][3];     // columna D
    // Filas válidas: tienen nombre de buque Y el coeficiente es numérico
    if (!buque || typeof coef !== 'number') continue;
    out.push({
      tipo: tipo,
      marca: s(vals[r][0]),
      agencia: s(vals[r][1]),
      buque: buque,
      coef: coef,
      fechaRecalada: fmtFecha(vals[r][4]),
      horaRecalada: fmtHora(vals[r][5]),
      fechaConfirmado: fmtFecha(vals[r][6]),
      horaConfirmado: fmtHora(vals[r][7]),
      desde: s(vals[r][8]),
      hasta: s(vals[r][9]),
      observaciones: s(vals[r][10])
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// HOJA "NOVEDADES" — historial (fecha, autor, texto)
// ─────────────────────────────────────────────────────────────
function parseNovedades(sheet) {
  if (!sheet) return [];
  var vals = sheet.getDataRange().getValues();
  var out = [];
  for (var r = 0; r < vals.length; r++) {
    var fecha = vals[r][0];
    var texto = s(vals[r][2]);
    if (!(fecha instanceof Date) || !texto) continue;
    out.push({
      fecha: fmtFecha(fecha),
      fechaISO: fecha.toISOString(),
      autor: s(vals[r][1]),
      texto: texto
    });
  }
  // más reciente primero
  out.sort(function (a, b) { return b.fechaISO.localeCompare(a.fechaISO); });
  return out;
}

// ─────────────────────────────────────────────────────────────
// HOJA "GUARDIA REMISES" — turno 07-19 y turno 19-07
// col B/C: pos, nombre (turno 1) | col G/H: pos, nombre (turno 2, aprox.)
// ─────────────────────────────────────────────────────────────
function parseRemises(sheet) {
  if (!sheet) return { turno1: [], turno2: [] };
  var vals = sheet.getDataRange().getValues();
  var turno1 = [], turno2 = [];
  for (var r = 0; r < vals.length; r++) {
    var pos1 = vals[r][1], nom1 = s(vals[r][2]), obs1 = s(vals[r][3]);
    var pos2 = vals[r][5], nom2 = s(vals[r][6]), obs2 = s(vals[r][7]);
    if (nom1 && typeof pos1 === 'number') turno1.push({ pos: pos1, nombre: nom1, obs: obs1 });
    if (nom2 && typeof pos2 === 'number') turno2.push({ pos: pos2, nombre: nom2, obs: obs2 });
  }
  return { turno1: turno1, turno2: turno2 };
}

// ─────────────────────────────────────────────────────────────
// HOJA "GUARDIA" — buques en tránsito (bloques "EN VIAJE A/DE
// ROSARIO" y "EN VIAJE A/DE CAMPANA"). Formato visual tipo planilla:
// cada buque ocupa 2 filas (nombre+calado en la primera, horarios en
// la segunda). Se ubica por etiquetas ancla, no por número de fila fijo,
// para tolerar que la cantidad de buques varíe semana a semana.
// ─────────────────────────────────────────────────────────────
function parseTransitos(sheet) {
  if (!sheet) return { aRosario: [], guardiaRosario: [], aCampana: [] };
  var vals = sheet.getDataRange().getValues();
  var col = function (letra) {
    var n = 0;
    for (var i = 0; i < letra.length; i++) n = n * 26 + (letra.charCodeAt(i) - 64);
    return n - 1;
  };
  var A=col('A'),B=col('B'),Cc=col('C'),E=col('E'),H=col('H'),I=col('I'),
      L=col('L'),Q=col('Q'),S=col('S'),U=col('U'),Y=col('Y'),Z=col('Z');

  function buscarFila(colIdx, textoInicio, desde) {
    for (var r = desde || 0; r < vals.length; r++) {
      if (s(vals[r][colIdx]).toUpperCase().indexOf(textoInicio) === 0) return r;
    }
    return -1;
  }

  // ── EN VIAJE A ROSARIO (buques subiendo, 2 filas por buque) ──
  var aRosario = [];
  var rInicio = buscarFila(A, 'EN VIAJE A ROSARIO', 0);
  var rFin = buscarFila(A, 'EN VIAJE DE ROSARIO', rInicio + 1);
  if (rInicio >= 0) {
    var limite = rFin > 0 ? rFin : vals.length;
    for (var r = rInicio + 1; r + 1 < limite; r += 2) {
      var buque = s(vals[r][I]);
      if (!buque) continue;
      aRosario.push({
        buque: buque,
        calado: s(vals[r][Q]),
        canal: s(vals[r][S]),
        practicos: [s(vals[r][B]), s(vals[r + 1][B])].filter(Boolean),
        horaEmbarque: s(vals[r + 1][E]),
        horaSalidaNorte: s(vals[r + 1][L]),
        horaLlegadaSur: s(vals[r + 1][Q])
      });
    }
  }

  // ── GUARDIA ROSARIO (prácticos de bajada disponibles, junto al bloque anterior) ──
  var guardiaRosario = [];
  var rGuardia = buscarFila(U, 'GUARDIA ROSARIO', 0);
  if (rGuardia >= 0) {
    for (var rg = rGuardia + 1; rg < vals.length; rg++) {
      var nombreG = s(vals[rg][U]);
      if (!nombreG) break;
      guardiaRosario.push({ practico: nombreG, tipo: s(vals[rg][Y]), hora: s(vals[rg][Z]) });
    }
  }

  // ── EN VIAJE A CAMPANA (2 filas por buque) ──
  var aCampana = [];
  var rCampInicio = buscarFila(B, 'EN VIAJE A CAMPANA', 0);
  var rCampFin = buscarFila(B, 'MOVIMIENTOS', rCampInicio + 1);
  if (rCampInicio >= 0) {
    var limiteC = rCampFin > 0 ? rCampFin : vals.length;
    for (var rc = rCampInicio + 1; rc + 1 < limiteC; rc += 2) {
      var buqueC = s(vals[rc][E]);
      if (!buqueC) continue;
      aCampana.push({
        buque: buqueC,
        practico: s(vals[rc][B]),
        canal: s(vals[rc][I]),
        horaEmbarque: s(vals[rc + 1][Cc]),
        horaDesembarque: s(vals[rc + 1][H])
      });
    }
  }

  return { aRosario: aRosario, guardiaRosario: guardiaRosario, aCampana: aCampana };
}
