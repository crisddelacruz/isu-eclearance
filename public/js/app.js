(function () {
  document.querySelectorAll('.progress[role="progressbar"]').forEach(function (progress) {
    var fill = progress.querySelector('span');
    if (fill) fill.style.width = progress.getAttribute('aria-valuenow') + '%';
  });

  // ---------- Landing: mobile menu ----------
  var navToggle = document.getElementById('navToggle');
  var navLinks = document.getElementById('navLinks');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var open = navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
    navLinks.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ---------- Landing: shadow when scrolled ----------
  var nav = document.querySelector('.l-nav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ---------- Dashboard: sidebar on mobile ----------
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sbOverlay');
  var sbToggle = document.getElementById('sbToggle');
  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
  }
  if (sidebar && sbToggle) {
    sbToggle.addEventListener('click', function () {
      sidebar.classList.add('open');
      if (overlay) overlay.classList.add('show');
    });
    if (overlay) overlay.addEventListener('click', closeSidebar);
  }

  // ---------- Dashboard: user dropdown ----------
  var userBtn = document.getElementById('userBtn');
  var userMenu = document.getElementById('userMenu');
  function closeMenu() {
    if (userMenu) userMenu.hidden = true;
    if (userBtn) userBtn.setAttribute('aria-expanded', 'false');
  }
  if (userBtn && userMenu) {
    userBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var willOpen = userMenu.hidden;
      userMenu.hidden = !willOpen;
      userBtn.setAttribute('aria-expanded', String(willOpen));
    });
    document.addEventListener('click', function (e) {
      if (!userMenu.contains(e.target)) closeMenu();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeMenu(); closeSidebar(); }
  });

  // ---------- Scroll reveal ----------
  var els = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12 });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(function (el) { el.classList.add('in'); });
  }
})();