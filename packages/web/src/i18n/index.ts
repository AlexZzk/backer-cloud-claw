import { createI18n } from 'vue-i18n';
import zhCN from './zh-CN';
import enUS from './en-US';

export type Locale = 'zh-CN' | 'en-US';

const savedLocale = (localStorage.getItem('bcc-locale') as Locale) || 'zh-CN';

export const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
});

export function setLocale(locale: Locale) {
  i18n.global.locale.value = locale;
  localStorage.setItem('bcc-locale', locale);
  document.documentElement.lang = locale === 'zh-CN' ? 'zh' : 'en';
}
