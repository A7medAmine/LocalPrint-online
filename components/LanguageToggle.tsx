import React from "react";
import { Language } from "../types";

interface LanguageToggleProps {
  currentLang: Language;
  onToggle: (lang: Language) => void;
}

const LanguageToggle: React.FC<LanguageToggleProps> = ({
  currentLang,
  onToggle,
}) => {
  return (
    <div
      dir="ltr"
      className="relative inline-flex items-center bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full p-[3px]"
      role="group"
      aria-label="Language selector"
    >
      {/* Sliding pill */}
      <div
        className="absolute top-[3px] bottom-[3px] rounded-full bg-indigo-600 transition-transform duration-300 ease-out will-change-transform"
        style={{
          width: "calc(50% - 3px)",
          transform:
            currentLang === "ar"
              ? "translateX(calc(100% + 2px))"
              : "translateX(0)",
        }}
        aria-hidden="true"
      />

      {(["en", "ar"] as Language[]).map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => onToggle(lang)}
          aria-pressed={currentLang === lang}
          className={`relative z-10 w-12 py-1.5 text-xs font-medium rounded-full transition-colors duration-200 text-center ${
            currentLang === lang ? "text-white" : "text-gray-500 dark:text-gray-400"
          }`}
        >
          {lang === "en" ? "EN" : "عربي"}
        </button>
      ))}
    </div>
  );
};

export default LanguageToggle;
