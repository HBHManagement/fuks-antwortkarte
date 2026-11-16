// Antwortkarte: Foto aufnehmen/auswählen, verkleinern, senden.
(function () {
  'use strict';

  var form = document.getElementById('kartenform');
  if (!form) return;

  var input = document.getElementById('foto');
  var video = document.getElementById('kamera');
  var preview = document.getElementById('vorschau');
  var empty = document.getElementById('shot-empty');
  var shot = document.querySelector('.shot');
  var btnKamera = document.getElementById('btn-kamera');
  var btnDatei = document.getElementById('btn-datei');
  var btnAusloesen = document.getElementById('btn-ausloesen');
  var btnNochmal = document.getElementById('btn-nochmal');
  var btnSenden = document.getElementById('btn-senden');
  var meldung = document.getElementById('meldung');

  var MAX_KANTE = 2200;          // längste Bildkante nach dem Verkleinern
  var QUALITAET = 0.86;
  var stream = null;
  var blob = null;               // das fertige, verkleinerte Bild
  var gesendet = false;

  function setzeMeldung(text, art) {
    meldung.textContent = text || '';
    meldung.className = 'meldung' + (art ? ' ' + art : '');
  }

  function zeigeVorschau(url) {
    preview.src = url;
    preview.hidden = false;
    empty.hidden = true;
    shot.classList.add('has-img');
    btnNochmal.hidden = false;
    btnSenden.disabled = false;
  }

  function stoppeKamera() {
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    video.hidden = true;
    video.srcObject = null;
    btnAusloesen.hidden = true;
  }

  // Bild verkleinern, damit der Upload auch im Mobilfunk schnell durchgeht.
  function verkleinere(file, callback) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var skala = Math.min(1, MAX_KANTE / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * skala));
        var ch = Math.max(1, Math.round(h * skala));
        var c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        c.toBlob(function (b) { callback(b, cw, ch); }, 'image/jpeg', QUALITAET);
      };
      img.onerror = function () { setzeMeldung('Das Bild konnte nicht gelesen werden.', 'err'); };
      img.src = reader.result;
    };
    reader.onerror = function () { setzeMeldung('Die Datei konnte nicht gelesen werden.', 'err'); };
    reader.readAsDataURL(file);
  }

  function uebernehmeDatei(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
      setzeMeldung('Bitte ein Bild auswählen.', 'err');
      return;
    }
    setzeMeldung('Bild wird vorbereitet …');
    verkleinere(file, function (b, cw, ch) {
      if (!b) { setzeMeldung('Das Bild konnte nicht verarbeitet werden.', 'err'); return; }
      blob = b;
      zeigeVorschau(URL.createObjectURL(b));
      setzeMeldung(ch + ' × ' + cw + ' px, ' + Math.round(b.size / 1024) + ' kB bereit.', '');
    });
  }

  // Der direkte Kameraweg: nur in sicherem Kontext (HTTPS) verfügbar.
  function starteKamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
      .then(function (s) {
        stream = s;
        video.srcObject = s;
        video.hidden = false;
        empty.hidden = true;
        preview.hidden = true;
        btnAusloesen.hidden = false;
        btnKamera.hidden = true;
      })
      .catch(function () { input.click(); });   // verweigert/nicht erlaubt → Dateiweg
    return true;
  }

  btnKamera.addEventListener('click', function () {
    setzeMeldung('');
    if (starteKamera()) return;
    input.click();                              // Fallback: Kamera des Systems
  });

  btnDatei.addEventListener('click', function () { setzeMeldung(''); input.click(); });

  input.addEventListener('change', function () {
    stoppeKamera();
    uebernehmeDatei(input.files && input.files[0]);
  });

  btnAusloesen.addEventListener('click', function () {
    if (!video.videoWidth) return;
    var c = document.createElement('canvas');
    var skala = Math.min(1, MAX_KANTE / Math.max(video.videoWidth, video.videoHeight));
    c.width = Math.round(video.videoWidth * skala);
    c.height = Math.round(video.videoHeight * skala);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    c.toBlob(function (b) {
      blob = b;
      stoppeKamera();
      btnNochmal.hidden = false;
      btnSenden.disabled = false;
      zeigeVorschau(URL.createObjectURL(b));
      setzeMeldung('Aufnahme bereit (' + Math.round(b.size / 1024) + ' kB).', '');
    }, 'image/jpeg', QUALITAET);
  });

  btnNochmal.addEventListener('click', function () {
    blob = null;
    gesendet = false;
    preview.hidden = true;
    preview.removeAttribute('src');
    empty.hidden = false;
    shot.classList.remove('has-img');
    btnNochmal.hidden = true;
    btnKamera.hidden = false;
    btnSenden.disabled = true;
    input.value = '';
    setzeMeldung('');
  });

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (gesendet || !blob) return;

    var firma = form.firma.value.trim();
    if (!firma) {
      setzeMeldung('Bitte den Firmennamen angeben.', 'err');
      form.firma.focus();
      return;
    }

    var daten = new FormData();
    daten.append('foto', blob, 'antwortkarte.jpg');
    daten.append('firma', firma);
    daten.append('name', form.name.value.trim());
    daten.append('email', form.email.value.trim());

    btnSenden.disabled = true;
    setzeMeldung('Wird gesendet …');

    fetch('/api/antwortkarte', { method: 'POST', body: daten })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Server nicht erreichbar.' }; }); })
      .then(function (d) {
        if (d && d.ok) {
          gesendet = true;
          setzeMeldung('Danke – Ihre Antwortkarte ist bei uns angekommen. Wir melden uns.', 'ok');
          btnSenden.hidden = true;
          btnKamera.hidden = true;
          btnNochmal.hidden = true;
          if (scanbar) scanbar.hidden = true;
        } else {
          setzeMeldung((d && d.error) || 'Das hat nicht geklappt. Bitte erneut versuchen.', 'err');
          btnSenden.disabled = false;
        }
      })
      .catch(function () {
        setzeMeldung('Keine Verbindung. Bitte Internet prüfen und erneut senden.', 'err');
        btnSenden.disabled = false;
      });
  });

  window.addEventListener('pagehide', stoppeKamera);

  // Der Balken unten ist nur der Weg zum Scanner: steht man schon dort, verschwindet er.
  var scanbar = document.getElementById('scanbar');
  var scanSection = document.getElementById('scannen');
  if (scanbar && scanSection) {
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (eintraege) {
        scanbar.hidden = eintraege[0].isIntersecting || gesendet;
      }, { rootMargin: '-35% 0px -35% 0px' }).observe(scanSection);
    }
    scanbar.addEventListener('click', function () {
      var f = document.getElementById('f-firma');
      if (f) setTimeout(function () { f.focus({ preventScroll: true }); }, 600);
    });
  }

  // Abschnitte unterhalb des Scanners sanft einblenden. Ohne JS und bei
  // reduzierter Bewegung bleibt alles sofort sichtbar.
  var abschnitte = [].slice.call(document.querySelectorAll('main > section')).slice(1);
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var beobachter = new IntersectionObserver(function (eintraege) {
      eintraege.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); beobachter.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -12% 0px' });
    abschnitte.forEach(function (s) { s.classList.add('reveal'); beobachter.observe(s); });
  }
})();
