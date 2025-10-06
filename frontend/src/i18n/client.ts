// frontend/src/i18n/client.ts
"use client";

import i18n from "./config";
import { initReactI18next } from "react-i18next";

// Initialize React bindings for i18next (client side only)
i18n.use(initReactI18next).init();

export default i18n;
