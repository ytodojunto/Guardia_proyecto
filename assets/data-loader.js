// ── CARGA DE DATOS EN VIVO DESDE GOOGLE SHEETS (vía Apps Script) ──
(function () {

  function esc(str) {
    return String(str || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function soloDigitos(str) {
    return String(str || '').replace(/\D/g, '');
  }

  async function cargarDatos() {
    var url = window.GUARDIA_API_URL;
    if (!url || url.indexOf('PENDIENTE') === 0) {
      console.warn('Falta configurar GUARDIA_API_URL en assets/config.js');
      return;
    }
    var clave = sessionStorage.getItem('mp_clave') || '';
    var urlConClave = url + (url.indexOf('?') === -1 ? '?' : '&') + 'clave=' + encodeURIComponent(clave);
    try {
      var resp = await fetch(urlConClave, { cache: 'no-store' });
      var data = await resp.json();
      if (data.error) { console.error('Backend rechazó el acceso:', data.error); return; }
      renderTurno(data.turno);
      renderPrevistos(data.previstos);
      renderNovedades(data.novedades);
      renderRemises(data.remises);
      renderBuques(data.transitos);
      var fechaEl = document.querySelector('.hdr-fecha');
      if (fechaEl && data.actualizado) {
        var d = new Date(data.actualizado);
        fechaEl.textContent = '📅 Actualizado: ' + d.toLocaleDateString('es-AR') + ' — ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      }
    } catch (err) {
      console.error('Error cargando datos de guardia:', err);
    }
  }

  // ── TURNO ──────────────────────────────────────────────────────
  function renderTurno(t) {
    if (!t) return;
    var listaTurno = document.getElementById('listaTurno');
    var listaFrancos = document.getElementById('listaFrancos');
    var cardVarios = document.getElementById('cardVarios');
    if (!listaTurno || !listaFrancos) return;

    listaTurno.innerHTML = t.practicos.map(function (p, i) {
      // El asterisco de la planilla significa "el operador se comunicó con el práctico"
      // (no un cambio de turno) — se muestra como una etiqueta discreta, sin recolorear el nombre.
      return '<div class="prac-row" data-tipo="turno' + (p.cambio ? ' cambio' : '') + '" data-nombre="' + esc(p.nombre) + '" data-pos="' + esc(p.pos) + '" data-hora="' + esc(soloDigitos(p.detalle)) + '">' +
        '<div class="prac-num">' + esc(p.pos) + '</div>' +
        '<div class="prac-info"><div class="prac-nombre">' + esc(p.nombre) + (p.cambio ? ' <span class="badge b-verde" style="font-size:9px;vertical-align:middle">📞 Contactado</span>' : '') + '</div>' +
        '<div class="prac-detalle">' + esc(p.destino) + (p.destino && p.detalle ? ' — ' : '') + esc(p.detalle) + '</div></div>' +
        '<div class="prac-badge">' + esc(p.tipo || '—') + '</div></div>';
    }).join('') || '<div class="empty">Sin prácticos en turno cargados</div>';

    listaFrancos.innerHTML = t.francos.map(function (f, i) {
      return '<div class="franco-row" data-tipo="franco' + (f.cambio ? ' cambio' : '') + '" data-nombre="' + esc(f.nombre) + '">' +
        '<div class="franco-top"><div class="franco-num">' + esc(f.nro || (i + 1)) + '</div>' +
        '<div class="franco-nombre">' + esc(f.nombre) + '</div><span class="badge b-naranja">FRANCO</span></div>' +
        '<div class="franco-fechas"><span>Salida: ' + esc(f.fechaSalida) + ' – ' + esc(f.horaSalida) + '</span>' +
        (f.fechaIngreso ? '<span>Regresa: ' + esc(f.fechaIngreso) + ' – ' + esc(f.horaIngreso) + '</span>' : '') + '</div></div>';
    }).join('') || '<div class="empty">Sin francos cargados</div>';

    if (cardVarios) {
      var varios = '';
      if (t.enfermos.length) {
        varios += '<div class="sec-label">Enfermos</div>';
        varios += t.enfermos.map(function (en) {
          return '<div class="varios-row" data-tipo="varios" data-nombre="' + esc(en.nombre) + '">' +
            '<div class="varios-icon">🏥</div><div><div class="varios-nombre">' + esc(en.nombre) + '</div>' +
            '<div class="varios-detalle">Desde ' + esc(en.fecha) + (en.hora ? ' – ' + esc(en.hora) : '') + '</div></div></div>';
        }).join('');
      }
      if (t.observaciones.length) {
        varios += '<div class="sec-label">Observaciones</div>';
        varios += t.observaciones.map(function (obs) {
          return '<div class="varios-row" data-tipo="varios"><div class="varios-icon">📋</div><div><div class="varios-detalle">' + esc(obs) + '</div></div></div>';
        }).join('');
      }
      cardVarios.innerHTML = '<div class="card-head"><span>🔵</span><span class="card-head-title">Varios</span><span class="card-head-count">' + (t.enfermos.length + t.observaciones.length) + '</span></div>' +
        (varios || '<div class="empty">Sin novedades de turno</div>');
    }

    // stats
    var stats = document.querySelectorAll('.stats-row .stat-num');
    if (stats.length >= 4) {
      stats[0].textContent = t.practicos.length;
      stats[1].textContent = t.francos.length;
      stats[2].textContent = t.enfermos.length + t.observaciones.length;
      stats[3].textContent = t.practicos.filter(function (p) { return p.cambio; }).length;
    }
    var cntTurno = document.getElementById('cntTurno');
    var cntFrancos = document.getElementById('cntFrancos');
    if (cntTurno) cntTurno.textContent = t.practicos.length;
    if (cntFrancos) cntFrancos.textContent = t.francos.length;
  }

  // ── PREVISTOS (subidas / bajadas / campana) ──────────────────
  function renderPrevistos(lista) {
    var cont = document.getElementById('listaPrevistos');
    if (!cont || !lista) return;
    cont.innerHTML = lista.map(function (b) {
      var obs = b.observaciones || '';
      var estado = 'sin';
      if (/AUTORIZADO/i.test(obs) && !/NO AUT/i.test(obs)) estado = 'autorizado';
      else if (/NO AUT/i.test(obs)) estado = 'posible';
      // Antes había un tercer criterio (si tenía fechaConfirmado -> autorizado) que
      // generaba falsos positivos: tener una fecha de Z.C./confirmación cargada no
      // significa que la agencia haya autorizado el despacho. Solo el texto explícito
      // ("AUTORIZADO" / "NO AUT") define el estado; si no dice nada, queda "sin confirmar".
      var tipoFiltro = b.tipo === 'campana' ? 'movimiento' : b.tipo;
      var dataHora = soloDigitos(b.fechaRecalada) + soloDigitos(b.horaRecalada);
      var icon = b.tipo === 'subida' ? '⬆️' : (b.tipo === 'bajada' ? '⬇️' : '🔄');
      var marcaBadge = '';
      if (b.marca === 'X') marcaBadge = '<span class="badge b-verde">✔ Despachado</span>';
      else if (b.marca === '*') marcaBadge = '<span class="badge b-naranja">🔔 Novedad agencia</span>';
      return '<div class="buque-row ' + estado + '" data-tipo="' + tipoFiltro + '" data-nombre="' + esc(b.buque) + '" data-agencia="' + esc(b.agencia) + '" data-hora="' + esc(dataHora) + '" data-estado="' + estado + '">' +
        '<div class="buque-top"><div class="buque-nombre">' + icon + ' ' + esc(b.buque) + '</div><div class="buque-cf">CF ' + esc(b.coef) + '</div></div>' +
        (marcaBadge ? '<div style="padding:0 12px 6px">' + marcaBadge + '</div>' : '') +
        '<div class="buque-bottom">' +
        '<div class="buque-dato"><span>Agencia</span><strong>' + esc(b.agencia) + '</strong></div>' +
        '<div class="buque-dato"><span>Recalada</span><strong>' + esc(b.fechaRecalada) + ' ' + esc(b.horaRecalada) + '</strong></div>' +
        (b.fechaConfirmado ? '<div class="buque-dato"><span>Confirmado</span><strong>' + esc(b.fechaConfirmado) + ' ' + esc(b.horaConfirmado) + '</strong></div>' : '') +
        '<div class="buque-dato"><span>Ruta</span><strong>' + esc(b.desde) + ' → ' + esc(b.hasta) + '</strong></div>' +
        '</div>' +
        (obs ? '<div class="buque-obs">' + esc(obs) + '</div>' : '') +
        '</div>';
    }).join('') || '<div class="empty">Sin buques previstos cargados</div>';
  }

  // ── NOVEDADES ──────────────────────────────────────────────────
  var novedadesData = [];
  function renderNovedades(lista) {
    novedadesData = lista || [];
    pintarNovedades(novedadesData);
    var searchInput = document.getElementById('novSearch');
    if (searchInput && !searchInput.dataset.wired) {
      searchInput.dataset.wired = '1';
      searchInput.addEventListener('input', function () {
        var q = this.value.toLowerCase().trim();
        var filtradas = !q ? novedadesData : novedadesData.filter(function (n) {
          return (n.texto + ' ' + n.autor).toLowerCase().includes(q);
        });
        pintarNovedades(filtradas);
      });
    }
  }
  function pintarNovedades(lista) {
    var cont = document.getElementById('listaNov');
    if (!cont) return;
    cont.innerHTML = lista.map(function (n, i) {
      return '<div class="obs-item" data-orden="' + i + '">' +
        '<span class="obs-tag tag-azul">📋 ' + esc(n.autor || 'Guardia') + '</span>' +
        '<div class="obs-texto">' + esc(n.texto) + '</div>' +
        '<div class="obs-fecha">' + esc(n.fecha) + '</div></div>';
    }).join('') || '<div class="empty">Sin novedades</div>';
  }

  // ── REMISES (sección nueva) ─────────────────────────────────────
  function renderRemises(r) {
    var cont = document.getElementById('listaRemises');
    if (!cont || !r) return;
    function pintarTurno(lista) {
      return lista.map(function (p) {
        return '<div class="prac-row"><div class="prac-num">' + esc(p.pos) + '</div>' +
          '<div class="prac-info"><div class="prac-nombre">' + esc(p.nombre) + '</div>' +
          (p.obs ? '<div class="prac-detalle">' + esc(p.obs) + '</div>' : '') + '</div></div>';
      }).join('') || '<div class="empty">Sin remiseros cargados</div>';
    }
    cont.innerHTML =
      '<div class="card" style="margin-top:10px"><div class="card-head"><span>🚕</span><span class="card-head-title">Turno 07 a 19</span></div>' + pintarTurno(r.turno1) + '</div>' +
      '<div class="card"><div class="card-head"><span>🌙</span><span class="card-head-title">Turno 19 a 07</span></div>' + pintarTurno(r.turno2) + '</div>';
  }

  // ── BUQUES (en tránsito ahora, hoja GUARDIA) ────────────────────
  function renderBuques(t) {
    var cont = document.getElementById('listaBuquesDesp');
    if (!cont || !t) return;
    var html = '';

    t.aRosario.forEach(function (b) {
      html += '<div class="desp-card" data-tipo="bajada" data-nombre="' + esc(b.buque) + '">' +
        '<div class="desp-head bajada"><div><div class="desp-buque">' + esc(b.buque) + '</div>' +
        '<div class="desp-meta">En viaje a Rosario' + (b.canal ? ' · Canal ' + esc(b.canal) : '') + '</div></div>' +
        (b.calado ? '<span class="badge b-azul">' + esc(b.calado) + '</span>' : '') + '</div>' +
        '<div class="desp-body">' +
        (b.practicos.length ? '<div class="desp-practicos">' + b.practicos.map(function (p, i) {
          return '<div class="prac-chip"><div class="chip-pos">' + (i + 1) + '</div><div class="chip-nombre">' + esc(p) + '</div><div class="chip-icon">⚓</div></div>';
        }).join('') + '</div>' : '') +
        '<div class="desp-datos">' +
        (b.horaEmbarque ? '<div class="dato-row"><span class="dato-label">Embarque:</span><span class="dato-val">' + esc(b.horaEmbarque) + '</span></div>' : '') +
        (b.horaSalidaNorte ? '<div class="dato-row"><span class="dato-label">S. Norte:</span><span class="dato-val">' + esc(b.horaSalidaNorte) + '</span></div>' : '') +
        (b.horaLlegadaSur ? '<div class="dato-row"><span class="dato-label">S. Sur:</span><span class="dato-val">' + esc(b.horaLlegadaSur) + '</span></div>' : '') +
        '</div></div></div>';
    });

    t.aCampana.forEach(function (b) {
      html += '<div class="desp-card" data-tipo="movimiento" data-nombre="' + esc(b.buque) + '">' +
        '<div class="desp-head movimiento"><div><div class="desp-buque">' + esc(b.buque) + '</div>' +
        '<div class="desp-meta">En viaje a Campana' + (b.canal ? ' · Canal ' + esc(b.canal) : '') + '</div></div></div>' +
        '<div class="desp-body">' +
        (b.practico ? '<div class="desp-practicos"><div class="prac-chip"><div class="chip-pos">1</div><div class="chip-nombre">' + esc(b.practico) + '</div><div class="chip-icon">⚓</div></div></div>' : '') +
        '<div class="desp-datos">' +
        (b.horaEmbarque ? '<div class="dato-row"><span class="dato-label">Embarque:</span><span class="dato-val">' + esc(b.horaEmbarque) + '</span></div>' : '') +
        (b.horaDesembarque ? '<div class="dato-row"><span class="dato-label">Desembarque:</span><span class="dato-val">' + esc(b.horaDesembarque) + '</span></div>' : '') +
        '</div></div></div>';
    });

    if (t.guardiaRosario.length) {
      html += '<div class="card"><div class="card-head"><span>👥</span><span class="card-head-title">Guardia Rosario (bajada)</span></div>' +
        t.guardiaRosario.map(function (g) {
          return '<div class="prac-row"><div class="prac-num">•</div><div class="prac-info"><div class="prac-nombre">' + esc(g.practico) + '</div>' +
            '<div class="prac-detalle">' + esc(g.hora) + '</div></div><div class="prac-badge">' + esc(g.tipo || '—') + '</div></div>';
        }).join('') + '</div>';
    }

    document.querySelectorAll('#listaBuquesDesp .desp-card').forEach(function (el) { el.remove(); });
    var vacio = document.getElementById('emptyBuques');
    if (vacio) vacio.insertAdjacentHTML('beforebegin', html);
  }

  document.addEventListener('mp:auth-ok', cargarDatos);
})();
