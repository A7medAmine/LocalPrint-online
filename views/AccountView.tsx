import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Language, AccountProfile, AccountOrder } from "../types";
import { storageService } from "../services/storageService";
import { useAuth } from "../hooks/useAuth";
import { isCustomerAuthConfigured } from "../services/supabaseClient";
import AuthPanel from "../components/auth/AuthPanel";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent } from "../components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { toast } from "../components/ui/use-toast";

interface AccountViewProps {
  lang: Language;
}

const DEFAULT_PAPER_TYPE_OPTIONS = [
  { id: "normal", en: "Normal", ar: "عادي" },
  { id: "glossy", en: "Glossy", ar: "لامع" },
  { id: "cardboard", en: "Cardboard", ar: "ورق مقوى" },
];

const AccountView: React.FC<AccountViewProps> = ({ lang }) => {
  const isRtl = lang === "ar";
  const { user, accessToken, loading: authLoading, signOut } = useAuth();

  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [orders, setOrders] = useState<AccountOrder[]>([]);
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
      } catch (err) {
        console.error("Failed to load account data", err);
      } finally {
        setLoadingData(false);
      }
    })();
  }, [user, accessToken]);

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
    } catch (err) {
      toast({ title: isRtl ? "فشل حفظ الملف الشخصي" : "Failed to save profile", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!isCustomerAuthConfigured) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center text-gray-500 dark:text-gray-400">
        <p className="text-sm">
          {isRtl ? "حسابات العملاء غير مُفعّلة على هذا الخادم." : "Customer accounts aren't configured on this server."}
        </p>
      </div>
    );
  }

  if (authLoading) {
    return <div className="text-center text-gray-400 dark:text-gray-500 mt-16 text-sm">{isRtl ? "جارٍ التحميل..." : "Loading..."}</div>;
  }

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto">
        <AuthPanel isRtl={isRtl} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{isRtl ? "حسابي" : "My Account"}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
        </div>
        <Button variant="outline" onClick={() => signOut()}>
          {isRtl ? "تسجيل الخروج" : "Sign out"}
        </Button>
      </div>

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
                <Input id="account-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" disabled={saving || loadingData} />
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
            {orders.map((order) => (
              <Card key={order.id}>
                <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-gray-100 truncate text-sm sm:text-base">
                      {order.fileName}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 mt-0.5 flex-wrap">
                      {order.shopSlug ? (
                        <Link to={`/s/${order.shopSlug}/upload`} className="hover:underline text-indigo-600 dark:text-indigo-400">
                          {order.shopName || order.shopSlug}
                        </Link>
                      ) : (
                        <span>{order.shopName || (isRtl ? "متجر غير معروف" : "Unknown shop")}</span>
                      )}
                      <span className="w-1 h-1 rounded-full bg-gray-300 hidden sm:inline-block" />
                      <span>{new Date(order.uploadDate).toLocaleDateString(isRtl ? "ar-EG" : "en-US", { numberingSystem: "latn" })}</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 shrink-0 w-fit">
                    {order.status}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountView;
