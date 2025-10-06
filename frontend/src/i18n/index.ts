import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// 👇 Import translation files
import en from "./locales/en";
import hi from "./locales/hi";
import mr from "./locales/mr";

i18n
  .use(LanguageDetector) // auto detect browser language
  .use(initReactI18next) // pass i18n down to react-i18next
  .init({
    resources: {
      en: { translation: en },
      hi: { translation: hi },
      mr: { translation: mr },
    },
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // react already does escaping
    },
    detection: {
      order: ["querystring", "cookie", "localStorage", "navigator"],
      caches: ["localStorage"],
    },
  });

export default i18n;
