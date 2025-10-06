// frontend/src/i18n/config.ts
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en";
import hi from "./locales/hi";
import mr from "./locales/mr";

i18n
  .use(LanguageDetector)
  .init({
    resources: {
      en: { translation: en },
      hi: { translation: hi },
      mr: { translation: mr },
    },
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    detection: {
      order: ["querystring", "cookie", "localStorage", "navigator"],
      caches: ["localStorage"],
    },
  });

export default i18n;
