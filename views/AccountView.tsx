import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Language, AccountProfile, AccountOrder, ShopSettings, PrintJob, PrintStatus } from "../types";
import { storageService } from "../services/storageService";
import { calculatePrintPrice, formatPrice } from "../utils/pricingUtils";
import { useAuth } from "../hooks/useAuth";
import { isCustomerAuthConfigured } from "../services/supabaseClient";
import AuthPanel from "../components/auth/AuthPanel";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent } from "../components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { toast } from "../components/ui/use-toast";
import LanguageToggle from "../components/LanguageToggle";

interface AccountViewProps {
  lang: Language;
  onToggleLang: (lang: Language) => void;
}

const DEFAULT_PAPER_TYPE_OPTIONS = [
  { id: "normal", en: "Normal", ar: "عادي" },
  { id: "glossy", en: "Glossy", ar: "لامع" },
  { id: "cardboard", en: "Cardboard", ar: "ورق مقوى" },
];

interface ShopStats {
  shopSlug: string;
  shopName: string;
  orderCount: number;
  totalPages: number;
  totalSpent: number;
}

const AccountView: React.FC<AccountViewProps> = ({ lang, onToggleLang }) => {
  const isRtl = lang === "ar";
  const { user, accessToken, loading: authLoading, signOut } = useAuth();
  const lastShopSlug = localStorage.getItem("ps_last_shop_slug");

  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [shopSettingsBySlug, setShopSettingsBySlug] = useState<Record<string, ShopSettings>>({});
  const [loadingData, setLoadingData] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [defaultPaperTypeId, setDefaultPaperTypeId] = useState("normal");
  const [defaultCopies, setDefaultCopies] = useState(1);

  useEffect(() => {
    if (!user || !accessToken) return;
    (async () => {
      setLoadingData(true);
      try {
        const [profileData, orderData] = await Promise.all([
          storageService.getAccountProfile(accessToken),
          storageService.getAccountOrders(accessToken),
        ]);
        setProfile(profileData);
        setName(profileData.name || "");
        setPhone(profileData.phone || "");
        setDefaultPaperTypeId(profileData.defaultPaperTypeId || "normal");
        setDefaultCopies(profileData.defaultCopies || 1);
        setOrders(orderData);

        // Only fetch shop settings for orders that DON'T have a stored
        // totalPrice yet (legacy rows). New orders carry the price with them,
        // so we skip the extra round-trip entirely.
        const missingPriceSlugs = [
          ...new Set(
            orderData
              .filter((o) => o.totalPrice == null && o.shopSlug)
              .map((o) => o.shopSlug as string),
          ),
        ];
        if (missingPriceSlugs.length > 0) {
          const settingsEntries = await Promise.all(
            missingPriceSlugs.map(async (slug) => {
              try {
                return [slug, await storageService.getSettings(slug)] as const;
              } catch {
                return null;
              }
            }),
          );
          const settingsMap: Record<string, ShopSettings> = {};
          settingsEntries.forEach((entry) => { if (entry) settingsMap[entry[0]] = entry[1]; });
          setShopSettingsBySlug(settingsMap);
        }
      } catch (err) {
        console.error("Failed to load account data", err);
      } finally {
        setLoadingData(false);
      }
    })();
  }, [user, accessToken]);

  const orderPrice = (order: AccountOrder): number | null => {
    // Prefer the stored quoted price (fast path — no shop settings needed).
    if (order.totalPrice != null) return Number(order.totalPrice);
    if (!order.shopSlug) return null;
    const settings = shopSettingsBySlug[order.shopSlug];
    if (!settings) return null;
    const pages = (order.pageCount && order.pageCount > 0) ? order.pageCount : 1;
    return calculatePrintPrice(
      {
        id: order.id,
        printPreferences: {
          colorMode: (order.colorMode as "color" | "blackWhite") || "color",
          copies: order.copies || 1,
          paperType: order.paperType || "normal",
        },
      } as PrintJob,
      settings,
      pages,
    ).totalPrice;
  };

  // Per-shop stats: order count, total pages, total spent — uses the stored
  // quoted price where available, falls back to on-the-fly compute for legacy rows.
  const shopStats: ShopStats[] = useMemo(() => {
    const byShop = new Map<string, ShopStats>();
    for (const order of orders) {
      if (!order.shopSlug) continue;
      const pages = (order.pageCount && order.pageCount > 0) ? order.pageCount : 1;
      const spent = orderPrice(order) ?? 0;
      const existing = byShop.get(order.shopSlug) || {
        shopSlug: order.shopSlug,
        shopName: order.shopName || order.shopSlug,
        orderCount: 0,
        totalPages: 0,
        totalSpent: 0,
      };
      existing.orderCount += 1;
      existing.totalPages += pages * (order.copies || 1);
      existing.totalSpent += spent;
      byShop.set(order.shopSlug, existing);
    }
    return [...byShop.values()].sort((a, b) => b.totalSpent - a.totalSpent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, shopSettingsBySlug]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setSaving(true);
    try {
      const updated = await storageService.updateAccountProfile(accessToken, {
        name,
        phone,
        defaultPaperTypeId,
        defaultCopies,
      });
      setProfile(updated);
      toast({ title: isRtl ? "تم حفظ الملف الشخصي" : "Profile saved", variant: "success" });
    } catch {
      toast({ title: isRtl ? "فشل حفظ الملف الشخصي" : "Failed to save profile", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Header shared by every state — has back-link + language toggle so the
  // toggle is reachable even when signed out or the accounts feature is off.
  const pageHeader = (
    <div className="flex items-center justify-between gap-3 mb-4">
      {lastShopSlug ? (
        <Link
          to={`/s/${lastShopSlug}/upload`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
        >
          <svg className="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
          {isRtl ? "العودة إلى صفحة الرفع" : "Back to upload page"}
        </Link>
      ) : <span />}
      <LanguageToggle currentLang={lang} onToggle={onToggleLang} />
    </div>
  );

  if (!isCustomerAuthConfigured) {
    return (
      <div className="max-w-3xl mx-auto px-1" dir={isRtl ? "rtl" : "ltr"}>
        {pageHeader}
        <div className="max-w-md mx-auto mt-16 text-center text-gray-500 dark:text-gray-400">
          <p className="text-sm">
            {isRtl ? "حسابات العملاء غير مُفعّلة على هذا الخادم." : "Customer accounts aren't configured on this server."}
          </p>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="max-w-3xl mx-auto px-1" dir={isRtl ? "rtl" : "ltr"}>
        {pageHeader}
        <p className="text-center text-gray-400 dark:text-gray-500 mt-16 text-sm">{isRtl ? "جارٍ التحميل..." : "Loading..."}</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-1" dir={isRtl ? "rtl" : "ltr"}>
        {pageHeader}
        <AuthPanel isRtl={isRtl} />
      </div>
    );
  }

  const totalOrders = orders.length;
  const totalPagesAll = shopStats.reduce((s, x) => s + x.totalPages, 0);
  const totalSpentAll = shopStats.reduce((s, x) => s + x.totalSpent, 0);
  const statusOf = (s: string) => (s || "").toUpperCase();

  return (
    <div className="max-w-3xl mx-auto px-1 space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      {pageHeader}

      <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{isRtl ? "حسابي" : "My Account"}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate" dir="ltr">{user.email}</p>
        </div>
        <Button variant="outline" onClick={() => signOut()} className="shrink-0">
          {isRtl ? "تسجيل الخروج" : "Sign out"}
        </Button>
      </div>

      {/* Per-shop stats */}
      {shopStats.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">
            {isRtl ? "إحصائيات حسب المتجر" : "Stats by shop"}
          </h2>
          <div className="grid gap-2 sm:gap-3">
            {shopStats.map((s) => (
              <Card key={s.shopSlug}>
                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/s/${s.shopSlug}/upload`} className="font-semibold text-gray-900 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400 truncate block">
                      {s.shopName}
                    </Link>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {s.orderCount} {isRtl ? "طلب" : "orders"} · {s.totalPages} {isRtl ? "صفحة" : "pages"}
                    </p>
                  </div>
                  <div className="text-base font-bold text-indigo-600 dark:text-indigo-400 tabular-nums shrink-0" dir="ltr">
                    {formatPrice(s.totalSpent)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {shopStats.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400 px-1">
              <span>
                {isRtl
                  ? `${totalOrders} طلب · ${totalPagesAll} صفحة عبر ${shopStats.length} متجر`
                  : `${totalOrders} orders · ${totalPagesAll} pages across ${shopStats.length} shops`}
              </span>
              <span className="font-bold text-gray-700 dark:text-gray-200 tabular-nums" dir="ltr">
                {isRtl ? "الإجمالي: " : "Total: "}
                {formatPrice(totalSpentAll)}
              </span>
            </div>
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-4 sm:p-6">
          <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-4">
            {isRtl ? "المعلومات الافتراضية للرفع" : "Default upload info"}
          </h2>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="account-name">{isRtl ? "الاسم" : "Name"}</Label>
                <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" disabled={saving || loadingData} />
              </div>
              <div>
                <Label htmlFor="account-phone">{isRtl ? "رقم الهاتف" : "Phone"}</Label>
                <Input id="account-phone" type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" disabled={saving || loadingData} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>{isRtl ? "نوع الورق الافتراضي" : "Default paper type"}</Label>
                <Select value={defaultPaperTypeId} onValueChange={setDefaultPaperTypeId} disabled={saving || loadingData}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEFAULT_PAPER_TYPE_OPTIONS.map((pt) => (
                      <SelectItem key={pt.id} value={pt.id}>{isRtl ? pt.ar : pt.en}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {isRtl ? "يُستخدم عندما يتوفر هذا النوع لدى المتجر" : "Used whenever a shop offers this paper type"}
                </p>
              </div>
              <div>
                <Label htmlFor="account-copies">{isRtl ? "عدد النسخ الافتراضي" : "Default copies"}</Label>
                <Input
                  id="account-copies"
                  type="number"
                  min="1"
                  max="100"
                  value={defaultCopies}
                  onChange={(e) => setDefaultCopies(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                  className="mt-1"
                  disabled={saving || loadingData}
                />
              </div>
            </div>
            <Button type="submit" disabled={saving || loadingData}>
              {isRtl ? "حفظ" : "Save"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">
          {isRtl ? "طلباتي السابقة" : "My past uploads"}
        </h2>
        {loadingData ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">{isRtl ? "جارٍ التحميل..." : "Loading..."}</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">{isRtl ? "لا توجد طلبات بعد" : "No uploads yet"}</p>
        ) : (
          <div className="grid gap-2 sm:gap-3">
            {orders.map((order) => {
              const price = orderPrice(order);
              const status = statusOf(order.status);
              const statusClasses =
                status === PrintStatus.PRINTED
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : status === "REJECTED"
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
              return (
                <Card key={order.id}>
                  <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-gray-100 truncate text-sm sm:text-base" dir="auto">
                        {order.fileName}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 mt-0.5 flex-wrap">
                        {order.shopSlug ? (
                          <Link to={`/s/${order.shopSlug}/upload`} className="hover:underline text-indigo-600 dark:text-indigo-400" dir="auto">
                            {order.shopName || order.shopSlug}
                          </Link>
                        ) : (
                          <span>{order.shopName || (isRtl ? "متجر غير معروف" : "Unknown shop")}</span>
                        )}
                        <span className="w-1 h-1 rounded-full bg-gray-300 hidden sm:inline-block" />
                        <span dir="ltr">{new Date(order.uploadDate).toLocaleDateString(isRtl ? "ar-EG" : "en-US", { numberingSystem: "latn" })}</span>
                        {order.pageCount && (
                          <>
                            <span className="w-1 h-1 rounded-full bg-gray-300 hidden sm:inline-block" />
                            <span dir="ltr">
                              {order.pageCount * (order.copies || 1)} {isRtl ? "صفحة" : "pages"}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {price !== null && (
                        <span className="text-sm font-bold text-gray-700 dark:text-gray-200 tabular-nums" dir="ltr">
                          {formatPrice(price)}
                        </span>
                      )}
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full w-fit ${statusClasses}`}>
                        {isRtl
                          ? (status === PrintStatus.PRINTED ? "تمت الطباعة" : status === "REJECTED" ? "مرفوض" : "قيد الانتظار")
                          : status}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountView;
