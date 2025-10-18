"use client";

import { ReactNode, useEffect, useState } from "react";
import { ThemeProvider } from "next-themes";
import { I18nextProvider } from "react-i18next";
import { motion } from "framer-motion";

import i18n from "@/i18n/client";
import Header from "@/components/Header";

export default function ClientLayout({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Persist language selection across reloads
    const savedLang = localStorage.getItem("lang");
    if (savedLang && i18n.language !== savedLang) {
      i18n.changeLanguage(savedLang);
    }
  }, []);

  if (!mounted) {
    // Prevent mismatch flashes
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950 transition-colors duration-300" />
    );
  }

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <I18nextProvider i18n={i18n}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col min-h-screen
            bg-gradient-to-br from-white via-purple-50 to-purple-100
            dark:from-gray-950 dark:via-purple-900 dark:to-purple-950
            text-gray-900 dark:text-gray-100 transition-colors duration-500
            relative overflow-x-hidden"
        >
          {/* Glassy Navbar */}
          <Header />

          {/* Main Page */}
          <main className="flex-1 pt-20 max-w-screen-2xl mx-auto px-4 py-6">
            {children}
          </main>

          {/* Soft shimmer accent */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(168,85,247,0.1),transparent_70%)]" />
        </motion.div>
      </I18nextProvider>
    </ThemeProvider>
  );
}
