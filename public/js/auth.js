(function () {
  // ---- Show / hide password ----
  document.querySelectorAll('.pw-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.getElementById(btn.dataset.target);
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
    });
  });

  // ---- College -> Program dependent dropdown ----
  var college = document.getElementById('college_id');
  var program = document.getElementById('program_id');

  if (college && program) {
    var all = Array.prototype.map.call(
      program.querySelectorAll('option[data-college]'),
      function (o) { return { value: o.value, text: o.textContent.trim(), college: o.dataset.college }; }
    );
    var preselect = program.dataset.selected || '';

    function fillPrograms() {
      var c = college.value;
      program.innerHTML = '';

      var first = document.createElement('option');
      first.value = '';
      first.textContent = c ? 'Select your program' : 'Select your college first';
      program.appendChild(first);

      all.filter(function (p) { return p.college === c; }).forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p.value;
        opt.textContent = p.text;
        if (p.value === preselect) opt.selected = true;
        program.appendChild(opt);
      });

      program.disabled = !c;
      preselect = ''; // only keep the old choice on first load
    }

    college.addEventListener('change', fillPrograms);
    fillPrograms();
  }

  // ---- Prevent double submit ----
  document.querySelectorAll('form[data-once]').forEach(function (form) {
    form.addEventListener('submit', function () {
      var btn = form.querySelector('button[type="submit"]');
      if (btn) {
        btn.dataset.label = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Please wait...';
      }
    });
  });

  // Re-enable the button if the user comes back with the browser Back button
  window.addEventListener('pageshow', function () {
    document.querySelectorAll('form[data-once] button[type="submit"]').forEach(function (btn) {
      btn.disabled = false;
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
    });
  });
})();