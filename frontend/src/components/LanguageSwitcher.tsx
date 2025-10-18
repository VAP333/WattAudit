"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n/client";

const LANGS = [
  { code: "en", label: "🇬🇧 English" },
  { code: "hi", label: "🇮🇳 हिंदी" },
  { code: "mr", label: "🇮🇳 मराठी" },
];

export default function LanguageSwitcher() {
  const { i18n: i18nextInstance } = useTranslation();

  const handleChange = (lng: string) => {
    i18n.changeLanguage(lng);
    localStorage.setItem("i18nextLng", lng);
  };

  useEffect(() => {
    const saved = localStorage.getItem("i18nextLng");
    if (saved && i18nextInstance.language !== saved) {
      i18n.changeLanguage(saved);
    }
  }, [i18nextInstance]);

  return (
    <div className="flex items-center gap-2">
      {LANGS.map((lang) => (
        <button
          key={lang.code}
          onClick={() => handleChange(lang.code)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm ${
            i18n.language?.startsWith(lang.code)
              ? "bg-blue-600 text-white"
              : "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-blue-500 hover:text-white"
          }`}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );
}
