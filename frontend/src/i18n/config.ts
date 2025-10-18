import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en";
import hi from "./locales/hi";
import mr from "./locales/mr";

// ✅ Export this — needed by client.ts
export const i18nOptions = {
  resources: {
    en: { translation: en },
    hi: { translation: hi },
    mr: { translation: mr },
  },
  fallbackLng: "en",
  supportedLngs: ["en", "hi", "mr"],
  interpolation: { escapeValue: false },
  detection: {
    order: ["querystring", "cookie", "localStorage", "navigator"],
    caches: ["localStorage"],
  },
};

// ✅ Initialize once for server-side safety
if (!i18n.isInitialized) {
  i18n.use(LanguageDetector).use(initReactI18next).init(i18nOptions);
}

export default i18n;
