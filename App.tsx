import React, { useState, useEffect } from "react";
import { Routes, Route, useParams, Link } from "react-router-dom";
import { Language, ShopSettings } from "./types";
import { TRANSLATIONS } from "./constants";
import { storageService } from "./services/storageService";
import UploadView from "./views/UploadView";
import AccountView from "./views/AccountView";
import LanguageToggle from "./components/LanguageToggle";
import { useAuth } from "./hooks/useAuth";
import { isCustomerAuthConfigured } from "./services/supabaseClient";

const NoShopSpecified: React.FC<{ isRtl: boolean }> = ({ isRtl }) => (
  <div className="max-w-md mx-auto mt-16 text-center text-gray-500 dark:text-gray-400">
    <p className="text-lg font-semibold">
      {isRtl ? "لم يتم تحديد متجر" : "No shop specified"}
    </p>
    <p className="text-sm mt-2">
      {isRtl
        ? "استخدم رابط الرفع الخاص بالمتجر الذي حصلت عليه من صاحب المحل."
        : "Use the shop's upload link you were given."}
    </p>
  </div>
);

const UploadRoute: React.FC<{ lang: Language; onSettingsLoaded: (s: ShopSettings) => void }> = ({ lang, onSettingsLoaded }) => {
  const { shopSlug } = useParams<{ shopSlug: string }>();
  const [settings, setSettings] = useState<ShopSettings | undefined>(undefined);

  useEffect(() => {
    if (!shopSlug) return;
    (async () => {
      try {
        const serverSettings = await storageService.getSettings(shopSlug);
        setSettings(serverSettings);
        onSettingsLoaded(serverSettings);
        document.title = serverSettings.shopName;
      } catch (error) {
        console.error("Failed to load settings:", error);
      }
    })();
  }, [shopSlug]);

  if (!shopSlug) {
    return <NoShopSpecified isRtl={lang === "ar"} />;
  }

  return <UploadView lang={lang} shopSlug={shopSlug} shopSettings={settings} />;
};

const App: React.FC = () => {
  const { user } = useAuth();
  const [lang, setLang] = useState<Language>(() => {
    const savedLang = localStorage.getItem("ps_language") as Language;
    return savedLang || "ar";
  });

  const [settings, setSettings] = useState<ShopSettings>({
    shopName: "PrintShop Hub",
    logoUrl: null,
  });

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem("ps_dark_mode") === "true";
  });

  useEffect(() => {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    localStorage.setItem("ps_language", lang);
    window.dispatchEvent(new CustomEvent("ps:langchange", { detail: lang }));
  }, [lang]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("ps_dark_mode", String(darkMode));
  }, [darkMode]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-gray-950 flex flex-col antialiased font-sans selection:bg-indigo-100 dark:selection:bg-indigo-900/40 selection:text-indigo-900 dark:selection:text-indigo-200">
      <nav
        dir="ltr"
        style={{ direction: "ltr", flexDirection: "row" }}
        className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-100/50 dark:border-gray-800/50 px-6 py-2.5 flex items-center justify-between sticky top-0 z-50 shadow-sm dark:shadow-gray-900/30"
      >
        <div className="flex items-center gap-3" style={{ direction: "ltr" }}>
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white overflow-hidden shadow-sm">
            {settings.logoUrl ? (
              <img src={settings.logoUrl} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm-1 9H8v2h4v-2z" clipRule="evenodd" />
              </svg>
            )}
          </div>
          <div className="flex flex-col justify-center">
            <span dir="auto" className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100 truncate max-w-[150px] sm:max-w-[300px]">
              {settings.shopName || TRANSLATIONS.appTitle[lang]}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800 transition-all active:scale-95"
            aria-label={lang === "ar" ? "الوضع الليلي" : "Dark mode"}
          >
            {darkMode ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
          <LanguageToggle currentLang={lang} onToggle={setLang} />
          {isCustomerAuthConfigured && (
            <Link
              to="/account"
              className="p-2 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800 transition-all active:scale-95"
              aria-label={lang === "ar" ? "حسابي" : "My account"}
              title={user?.email || (lang === "ar" ? "تسجيل الدخول" : "Sign in")}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </Link>
          )}
        </div>
      </nav>

      <main className="flex-grow flex flex-col transition-opacity duration-150 container mx-auto py-6 px-4">
        <div key={lang} className="animate-[langFadeIn_0.25s_ease-out] flex-1 flex flex-col">
          <Routes>
            <Route path="/s/:shopSlug/upload" element={<UploadRoute lang={lang} onSettingsLoaded={setSettings} />} />
            <Route path="/account" element={<AccountView lang={lang} />} />
            <Route path="*" element={<NoShopSpecified isRtl={lang === "ar"} />} />
          </Routes>
        </div>
      </main>
    </div>
  );
};

export default App;
