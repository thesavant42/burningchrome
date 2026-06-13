// theme.js - Self-contained, CSP-compliant theme loader and switcher
(function () {
  // 1. Immediately apply saved theme to prevent flash of style
  const savedTheme = localStorage.getItem('theme') || 'dracula';
  document.documentElement.className = 'theme-' + savedTheme;

  // 2. Add event listener to the theme select dropdown once DOM is loaded
  document.addEventListener('DOMContentLoaded', () => {
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
      themeSelect.value = savedTheme;
      themeSelect.addEventListener('change', (e) => {
        const selectedTheme = e.target.value;
        localStorage.setItem('theme', selectedTheme);
        document.documentElement.className = 'theme-' + selectedTheme;

        // Synchronize other open tabs in the extension
        const allSelects = document.querySelectorAll('#themeSelect');
        allSelects.forEach((select) => {
          if (select !== themeSelect) {
            select.value = selectedTheme;
          }
        });
      });
    }
  });
})();
