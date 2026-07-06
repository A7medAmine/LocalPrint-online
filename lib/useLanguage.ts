import { useState, useEffect, useCallback } from "react";
import type { Language } from "../types";
import { TRANSLATIONS } from "../constants";

export function useLanguage() {
  const [lang, setLang] = useState<Language>(() => {
    return (localStorage.getItem("ps_language") as Language) || "ar";
  });

  useEffect(() => {
    const handler = () => {
      const stored = localStorage.getItem("ps_language") as Language;
      if (stored && stored !== lang) setLang(stored);
    };
    window.addEventListener("ps:langchange", handler);
    return () => window.removeEventListener("ps:langchange", handler);
  }, [lang]);

  const t = useCallback(
    (key: string) => {
      const entry = (TRANSLATIONS as any)[key];
      return entry ? entry[lang] : key;
    },
    [lang],
  );

  return { lang, t };
}
