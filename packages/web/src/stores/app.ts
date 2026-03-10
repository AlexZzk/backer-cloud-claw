import { defineStore } from 'pinia';
import { ref } from 'vue';
import { setLocale, type Locale } from '@/i18n';

export type Theme = 'light' | 'dark';

export const useAppStore = defineStore('app', () => {
  const savedTheme = (localStorage.getItem('bcc-theme') as Theme) || 'light';
  const theme = ref<Theme>(savedTheme);

  const savedLocale = (localStorage.getItem('bcc-locale') as Locale) || 'zh-CN';
  const locale = ref<Locale>(savedLocale);

  function setTheme(t: Theme) {
    theme.value = t;
    localStorage.setItem('bcc-theme', t);
    applyTheme(t);
  }

  function applyTheme(t: Theme) {
    const body = document.body;
    if (t === 'dark') {
      body.setAttribute('arco-theme', 'dark');
      body.classList.add('dark');
    } else {
      body.removeAttribute('arco-theme');
      body.classList.remove('dark');
    }
  }

  function toggleTheme() {
    setTheme(theme.value === 'light' ? 'dark' : 'light');
  }

  function changeLocale(l: Locale) {
    locale.value = l;
    setLocale(l);
  }

  // Apply on init
  applyTheme(savedTheme);

  return { theme, locale, setTheme, toggleTheme, changeLocale };
});
