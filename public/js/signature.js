(function () {
  // ---------- Tabs ----------
  var tabs = document.querySelectorAll('.tab[data-tab]');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', String(on));
        var panel = document.getElementById('panel-' + t.dataset.tab);
        if (panel) panel.hidden = !on;
      });
    });
  });

  // ---------- Upload: preview + early checks ----------
  var file = document.getElementById('sigFile');
  var preview = document.getElementById('sigPreview');
  var previewImg = preview ? preview.querySelector('img') : null;
  var uploadMsg = document.getElementById('uploadMsg');

  if (file && preview && previewImg) {
    file.addEventListener('change', function () {
      uploadMsg.textContent = '';
      uploadMsg.classList.remove('err');
      var f = file.files && file.files[0];
      if (!f) { preview.hidden = true; return; }

      if (['image/png', 'image/jpeg'].indexOf(f.type) === -1) {
        uploadMsg.textContent = 'Please choose a PNG or JPG image.';
        uploadMsg.classList.add('err');
        file.value = ''; preview.hidden = true; return;
      }
      if (f.size > 1024 * 1024) {
        uploadMsg.textContent = 'That image is larger than 1 MB. Please choose a smaller one.';
        uploadMsg.classList.add('err');
        file.value = ''; preview.hidden = true; return;
      }
      previewImg.src = URL.createObjectURL(f);
      preview.hidden = false;
    });
  }

  // ---------- Drawing pad ----------
  var canvas = document.getElementById('sigPad');
  if (!canvas) return;

  var box = document.getElementById('padBox');
  var msg = document.getElementById('padMsg');
  var clearBtn = document.getElementById('padClear');
  var saveBtn = document.getElementById('padSave');
  var ctx = canvas.getContext('2d');
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0b2a6f'; // pen-blue ink

  var drawing = false, drawn = false, last = null;

  function say(text, isError) {
    msg.textContent = text || '';
    msg.classList.toggle('err', !!isError);
  }
  function pos(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height)
    };
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    last = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(last.x + 0.01, last.y); // makes a dot on a simple tap
    ctx.stroke();
    drawn = true;
    say('');
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drawing) return;
    e.preventDefault();
    var p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
    canvas.addEventListener(ev, function () { drawing = false; });
  });

  clearBtn.addEventListener('click', function () {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawn = false;
    say('');
  });

  saveBtn.addEventListener('click', function () {
    if (!drawn) { say('Please draw your signature first.', true); return; }
    saveBtn.disabled = true;
    say('Saving...');

    fetch('/signatory/signature/draw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': box.dataset.csrf },
      body: JSON.stringify({ image: canvas.toDataURL('image/png') })
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        if (r.ok) { window.location.reload(); return; }
        say(r.data.error || 'Could not save your signature.', true);
        saveBtn.disabled = false;
      })
      .catch(function () {
        say('Could not reach the server. Please try again.', true);
        saveBtn.disabled = false;
      });
  });
})();