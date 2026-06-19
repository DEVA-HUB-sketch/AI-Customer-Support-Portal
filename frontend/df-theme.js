/* DeskFlow AI — Theme Engine (light / dark) */
(function () {
  var html = document.documentElement;

  /* Apply saved theme before first paint — prevents flash */
  var saved = localStorage.getItem('df-theme');
  if (saved === 'light') html.setAttribute('data-theme', 'light');

  function _syncIcons() {
    var isLight = html.getAttribute('data-theme') === 'light';
    document.querySelectorAll('.df-theme-icon').forEach(function (el) {
      el.className = (isLight ? 'ti ti-moon-stars' : 'ti ti-sun') + ' df-theme-icon';
    });
  }

  window.DFTheme = {
    toggle: function () {
      var isLight = html.getAttribute('data-theme') === 'light';
      var next = isLight ? 'dark' : 'light';
      html.setAttribute('data-theme', next);
      localStorage.setItem('df-theme', next);
      _syncIcons();
    }
  };

  /* Sync icons once DOM is ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _syncIcons);
  } else {
    _syncIcons();
  }
})();
