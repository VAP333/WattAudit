"use client";

import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Image from "next/image";

export default function Header() {
  const { i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const languages = [
    { code: "en", label: "English", short: "EN" },
    { code: "hi", label: "हिंदी", short: "HI" },
    { code: "mr", label: "मराठी", short: "MR" },
  ];

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const handleLanguageChange = (lng: string) => {
    i18n.changeLanguage(lng);
    localStorage.setItem("lang", lng);
  };

  return (
   <header
  className="
    fixed top-0 left-0 w-full z-50 backdrop-blur-2xl
    bg-white/30 dark:bg-purple-950/30
    border-b border-white/20 dark:border-purple-900/40
    flex items-center justify-between px-8 py-2 shadow-md
  "
>
  {/* Left: MSEB logo */}
  <motion.div
    initial={{ opacity: 0, y: -10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5 }}
  >
    <Image
      src="/assets/mseb.png"
      alt="MSEB Logo"
      width={70}
      height={70}
      className="block dark:hidden object-contain"
    />
    <Image
      src="/assets/mseb1.png"
      alt="MSEB Logo Dark"
      width={70}
      height={70}
      className="hidden dark:block object-contain"
    />
  </motion.div>

  {/* Center: WattAudit logo */}
  <motion.div
    initial={{ opacity: 0, y: -10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5 }}
    className="absolute left-1/2 -translate-x-1/2 flex justify-center items-center"
  >
    <Image
      src="/assets/logo.png"
      alt="WattAudit Logo"
      width={110}
      height={110}
      className="block dark:hidden object-contain"
    />
    <Image
      src="/assets/logo1.png"
      alt="WattAudit Logo Dark"
      width={110}
      height={110}
      className="hidden dark:block object-contain"
    />
  </motion.div>

  {/* Right: Language + Theme */}
  <div className="flex items-center gap-3 sm:gap-4">
    <div className="flex bg-white/40 dark:bg-purple-900/40 rounded-full p-1 backdrop-blur-xl border border-white/20">
      {languages.map(({ code, short, label }) => (
        <button
          key={code}
          onClick={() => handleLanguageChange(code)}
          className={`px-3 py-1 text-sm font-medium rounded-full transition-all duration-200
            ${
              i18n.language === code
                ? "bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white shadow-md"
                : "text-gray-700 dark:text-gray-200 hover:bg-white/30 dark:hover:bg-purple-800/40"
            }`}
          title={label}
        >
          {short}
        </button>
      ))}
    </div>

    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="p-2 rounded-full bg-white/40 dark:bg-purple-900/40 backdrop-blur-xl border border-white/20 transition hover:scale-105 hover:shadow-lg"
    >
      {theme === "dark" ? (
        <Sun className="w-5 h-5 text-yellow-400" />
      ) : (
        <Moon className="w-5 h-5 text-purple-600" />
      )}
    </button>
  </div>
</header>

  );
}
