"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n/client"; // ✅ ensures initialized React-i18next instance

const LANGS = [
  { code: "en", label: "🇬🇧 English" },
  { code: "hi", label: "🇮🇳 हिंदी" },
  { code: "mr", label: "🇮🇳 मराठी" },
];

export default function LanguageSwitcher() {
  const { i18n: i18nextInstance } = useTranslation();

  const handleChange = (lng: string) => {
    i18n.changeLanguage(lng); // ✅ call the imported initialized instance
    localStorage.setItem("i18nextLng", lng);
  };

  useEffect(() => {
    const savedLang = localStorage.getItem("i18nextLng");
    if (savedLang && i18nextInstance.language !== savedLang) {
      i18n.changeLanguage(savedLang);
    }
  }, [i18nextInstance]);

  return (
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
