(function () {
  // ---------- Bulk approve: select all + counter ----------
  var all = document.getElementById('checkAll');
  var boxes = document.querySelectorAll('.row-check');
  var btn = document.getElementById('bulkBtn');
  var count = document.getElementById('bulkCount');

  function sync() {
    var n = document.querySelectorAll('.row-check:checked').length;
    if (btn) btn.disabled = n === 0;
    if (count) count.textContent = n ? n + ' selected' : '';
    if (all) all.checked = boxes.length > 0 && n === boxes.length;
  }

  if (all) {
    all.addEventListener('change', function () {
      boxes.forEach(function (b) { b.checked = all.checked; });
      sync();
    });
  }
  boxes.forEach(function (b) { b.addEventListener('change', sync); });
  sync();

  // ---------- Return form: remarks counter ----------
  var remarks = document.getElementById('remarks');
  var counter = document.getElementById('remarksCount');
  if (remarks && counter) {
    var update = function () { counter.textContent = remarks.value.length + ' / 300'; };
    remarks.addEventListener('input', update);
    update();
  }
})();