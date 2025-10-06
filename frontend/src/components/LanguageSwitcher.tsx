"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";

const LANGS = [
  { code: "en", label: "🇬🇧 English" },
  { code: "hi", label: "🇮🇳 हिंदी" },
  { code: "mr", label: "🇮🇳 मराठी" },
];

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const handleChange = (lng: string) => {
    i18n.changeLanguage(lng);
    localStorage.setItem("i18nextLng", lng);
  };

  useEffect(() => {
    const savedLang = localStorage.getItem("i18nextLng");
    if (savedLang && i18n.language !== savedLang) {
      i18n.changeLanguage(savedLang);
    }
  }, [i18n]);

  return (
    // 👇 Add suppressHydrationWarning here
    <div className="flex items-center gap-2" suppressHydrationWarning>
      {LANGS.map((lang) => (
        <button
          key={lang.code}
          onClick={() => handleChange(lang.code)}
          className={`px-2 py-1 rounded text-sm transition ${
            i18n.language?.startsWith(lang.code)
              ? "bg-blue-600 text-white font-semibold"
              : "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200"
          }`}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );
}
