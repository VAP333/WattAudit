"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import DarkToggle from "@/components/DarkToggle";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default function Navbar() {
  const [visible, setVisible] = useState(true);
  const [lastScroll, setLastScroll] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const current = window.scrollY;
      setVisible(current < lastScroll || current < 50);
      setLastScroll(current);
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, [lastScroll]);

  return (
    <nav
      className={`fixed top-0 left-0 w-full z-50 transition-transform duration-500
        bg-gradient-to-r from-indigo-600/70 via-purple-600/70 to-pink-600/70
        dark:from-indigo-900/70 dark:via-purple-900/70 dark:to-pink-900/70
        backdrop-blur-md border-b border-white/10 shadow-lg
        ${visible ? "translate-y-0" : "-translate-y-full"}`}
    >
      <div className="max-w-screen-2xl mx-auto flex items-center justify-between p-3">
        {/* 🌟 Left Logo (MSEB) */}
        <div className="flex items-center gap-3">
          <Image
            src="/assets/mseb.png"
            alt="MSEB Logo"
            width={45}
            height={45}
            className="drop-shadow-md dark:hidden"
          />
          <Image
            src="/assets/mseb1.png"
            alt="MSEB Logo (Dark)"
            width={45}
            height={45}
            className="drop-shadow-md hidden dark:block"
          />
        </div>

        {/* 🌟 Center Logo (WattAudit++) */}
        <div className="flex items-center justify-center">
          <Image
            src="/assets/logo.png"
            alt="WattAudit++ Logo"
            width={140}
            height={40}
            className="drop-shadow-xl dark:hidden"
          />
          <Image
            src="/assets/logo1.png"
            alt="WattAudit++ Logo (Dark)"
            width={140}
            height={40}
            className="drop-shadow-xl hidden dark:block"
          />
        </div>

        {/* 🌟 Right Controls */}
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <DarkToggle />
        </div>
      </div>
    </nav>
  );
}
