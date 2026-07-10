// ── LOGIN SIMPLE (gate liviano, no reemplaza seguridad real) ──
// El hash es de "usuario:contraseña" en SHA-256. No es criptografía de
// nivel bancario, pero evita tener el usuario/contraseña en texto plano
// a simple vista en el código fuente.
(function () {
  var HASH_VALIDO = 'b48c2776ea1d0ad4e9fe47356ce873c6052230d7adeb8ff226787f968e770062';
  var SESSION_KEY = 'mp_guardia_auth';

  async function sha256(texto) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function ocultarOverlay() {
    document.getElementById('loginOverlay').classList.add('oculto');
  }

  function marcarSesionYContinuar(clave) {
    sessionStorage.setItem(SESSION_KEY, '1');
    sessionStorage.setItem('mp_clave', clave);
    ocultarOverlay();
    document.dispatchEvent(new CustomEvent('mp:auth-ok'));
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Si ya se logueó en esta pestaña, no pedir de nuevo
    if (sessionStorage.getItem(SESSION_KEY) === '1') {
      ocultarOverlay();
      document.dispatchEvent(new CustomEvent('mp:auth-ok'));
      return;
    }

    var form = document.getElementById('loginForm');
    var errorEl = document.getElementById('loginError');
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var user = document.getElementById('loginUser').value.trim();
      var pass = document.getElementById('loginPass').value;
      var hash = await sha256(user + ':' + pass);
      if (hash === HASH_VALIDO) {
        errorEl.style.display = 'none';
        marcarSesionYContinuar(pass);
      } else {
        errorEl.style.display = 'block';
      }
    });
  });
})();
