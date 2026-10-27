(function () {
  // Show only the form parts that apply to the chosen role.
  var role = document.getElementById('role');
  if (!role) return;

  function sync() {
    document.querySelectorAll('[data-roles]').forEach(function (el) {
      el.hidden = el.dataset.roles.split(' ').indexOf(role.value) === -1;
    });
  }
  role.addEventListener('change', sync);
  sync();
})();