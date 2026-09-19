import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import vi from './locales/vi.js';
import en from './locales/en.js';

const LOCALES = { vi, en };
const STORAGE_KEY = 'vbt_lang';

export const LanguageContext = createContext({
  lang: 'vi',
  setLang: () => {},
  t: (key) => key,
});

export function LanguageProvider({ children, initialLang }) {
  const [lang, setLangState] = useState(() => {
    if (initialLang && LOCALES[initialLang]) return initialLang;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && LOCALES[saved]) return saved;
    } catch { /* ignore */ }
    return 'vi';
  });

  const setLang = useCallback((newLang) => {
    if (LOCALES[newLang]) {
      setLangState(newLang);
      try {
        localStorage.setItem(STORAGE_KEY, newLang);
      } catch { /* ignore */ }
    }
  }, []);

  const t = useCallback((path, params = {}) => {
    const dict = LOCALES[lang] || LOCALES.vi;
    const keys = String(path || '').split('.');
    let res = dict;
    for (const k of keys) {
      if (res && typeof res === 'object' && k in res) {
        res = res[k];
      } else {
        // Fallback sang tiếng Việt nếu key thiếu ở ngôn ngữ khác
        let fb = LOCALES.vi;
        for (const fbk of keys) {
          if (fb && typeof fb === 'object' && fbk in fb) fb = fb[fbk];
          else { fb = null; break; }
        }
        res = fb || path;
        break;
      }
    }
    if (typeof res !== 'string') return String(path);

    // Thay thế biến {paramName}
    return res.replace(/\{(\w+)\}/g, (_, match) => (match in params ? params[match] : `{${match}}`));
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  return useContext(LanguageContext);
}
