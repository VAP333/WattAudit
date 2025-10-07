import "@/i18n/config";

 // initializes i18n globally on the server
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ReactNode } from "react";
import DarkToggle from "@/components/DarkToggle";
import LanguageSwitcher from "@/components/LanguageSwitcher";

// Load Geist fonts
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "WattAudit++",
  description: "Explainable AI Dashboard",
};

// ✅ Must return <html> and <body> (server component)
export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased 
          bg-gray-50 text-gray-900 
          dark:bg-gray-900 dark:text-gray-100 
          transition-colors duration-300 min-h-screen`}
      >
        <header className="flex justify-end p-4 gap-4">
          <LanguageSwitcher />
          <DarkToggle />
        </header>

        <main className="max-w-screen-2xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
