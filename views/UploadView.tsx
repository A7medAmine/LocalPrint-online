import React, { useState, useRef, useEffect } from "react";
import { Language, PrintJob, PrintStatus, ShopSettings, DiscountRule, DiscountResult } from "../types";
import { TRANSLATIONS, ALLOWED_TYPES } from "../constants";
import { storageService } from "../services/storageService";
import {
  calculatePrintPrice,
  getActualPageCount,
  formatPrice,
  calculateJobDiscount,
} from "../utils/pricingUtils";
import { toast } from "../components/ui/use-toast";
import { Toaster } from "../components/ui/toaster";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Card, CardContent } from "../components/ui/card";
import PreviewModal from "../components/preview/PreviewModal";

interface UploadViewProps {
  lang: Language;
  shopSlug: string;
  shopSettings?: ShopSettings;
}

interface FileStatus {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "success" | "error";
  id: string;
}

// Custom ID generator that works in non-secure contexts (HTTP over Local IP)
const generateSafeId = () => {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
};

const UploadView: React.FC<UploadViewProps> = ({ lang, shopSlug, shopSettings: propSettings }) => {
  const t = (key: string) => TRANSLATIONS[key][lang] || key;
  const isRtl = lang === "ar";
  // toast() imported from use-toast, called directly

  // Confirm dialog state for canceling jobs
  const [cancelConfirm, setCancelConfirm] = useState<{
    isOpen: boolean;
    jobId: string | null;
  }>({ isOpen: false, jobId: null });
  const [storeInfoOpen, setStoreInfoOpen] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    notes: "",
  });
  const [printPreferences, setPrintPreferences] = useState<{
    colorMode: "color" | "blackWhite";
    copies: number;
    paperType: string;
  }>({
    colorMode: "color",
    copies: 1,
    paperType: "normal",
  });
  const [selectedFiles, setSelectedFiles] = useState<FileStatus[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [overallSuccess, setOverallSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentJobs, setRecentJobs] = useState<PrintJob[]>([]);

  // Preview States
  const [previewJob, setPreviewJob] = useState<{ job: PrintJob; url: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pricing & Pages States
  const [shopSettings, setShopSettings] = useState<ShopSettings | null>(propSettings || null);
  const [jobPageCounts, setJobPageCounts] = useState<{
    [jobId: string]: number;
  }>({});
  const [filePageCounts, setFilePageCounts] = useState<{
    [fileId: string]: number;
  }>({});
  const [discountRules, setDiscountRules] = useState<DiscountRule[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Sync shopSettings when prop changes (e.g. settings loaded asynchronously from server)
  useEffect(() => {
    if (propSettings) {
      setShopSettings(propSettings);
    }
  }, [propSettings]);

  // Fetch recent jobs, settings, and discount rules on mount and after upload
  useEffect(() => {
    (async () => {
      try {
        const [jobs, settings, rules] = await Promise.all([
          storageService.getMyRecentJobs(shopSlug),
          propSettings ? Promise.resolve(propSettings) : storageService.getSettings(shopSlug),
          storageService.getActiveDiscountRules(shopSlug),
        ]);
        setRecentJobs(jobs);
        if (!propSettings) setShopSettings(settings);
        setDiscountRules(rules);
      } catch (err) {
        console.error("Failed to load recent data", err);
      }
    })();
  }, [overallSuccess, shopSlug]);

  // Compute page counts whenever recentJobs changes
  useEffect(() => {
    if (recentJobs.length === 0) return;
    const isImageType = (t: string) => t.includes("image");
    const counts: { [jobId: string]: number } = {};

    // Set known counts synchronously (PDFs with server pageCount, images = 1)
    for (const job of recentJobs) {
      if (job.pageCount && job.pageCount > 0) counts[job.id] = job.pageCount;
      else if (isImageType(job.fileType)) counts[job.id] = 1;
    }
    setJobPageCounts(counts);

    // Async refine for unknown types
    (async () => {
      for (const job of recentJobs) {
        if (counts[job.id] !== undefined) continue;
        if (isOfficeType(job.fileType)) continue;
        try {
          const url = await storageService.getFileUrl(shopSlug, job.id);
          if (!url) { counts[job.id] = 1; continue; }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          const response = await fetch(url, { signal: controller.signal });
          clearTimeout(timer);
          const blob = await response.blob();
          const file = new File([blob], job.fileName, { type: job.fileType });
          counts[job.id] = await getActualPageCount(file);
        } catch {
          counts[job.id] = 1;
        }
      }
      setJobPageCounts({ ...counts });
    })();
  }, [recentJobs]);

  // Count actual pages for selected files before upload
  useEffect(() => {
    const countPages = async () => {
      const counts: { [fileId: string]: number } = {};
      for (const fs of selectedFiles) {
        try {
          counts[fs.id] = await getActualPageCount(fs.file);
        } catch {
          counts[fs.id] = 1;
        }
      }
      setFilePageCounts(counts);
    };
    if (selectedFiles.length > 0) countPages();
    else setFilePageCounts({});
  }, [selectedFiles]);

  const handleCancelJob = (id: string) => {
    setCancelConfirm({ isOpen: true, jobId: id });
  };

  const confirmCancelJob = async () => {
    if (cancelConfirm.jobId) {
      try {
        await storageService.deleteJob(shopSlug, cancelConfirm.jobId);
        setRecentJobs((prev) => prev.filter((job) => job.id !== cancelConfirm.jobId));
        toast({ title: isRtl ? "تم إلغاء الطباعة بنجاح" : "Print job cancelled successfully", variant: "success" });
      } catch (err) {
        console.error("Failed to cancel job", err);
        toast({ title: isRtl ? "فشل إلغاء الطباعة" : "Failed to cancel print job", variant: "destructive" });
      }
    }
    setCancelConfirm({ isOpen: false, jobId: null });
  };

  const isOfficeType = (t: string) => t.includes("word") || t.includes("document") || t.includes("excel") || t.includes("spreadsheet") || t.includes("presentation") || t.includes("powerpoint");
  const isOfficeFile = (file: File) => isOfficeType(file.type);

  // Helper to calculate price with discount for a file
  const getFilePriceWithDiscount = (file: File, fileId?: string) => {
    if (!shopSettings) return null;
    if (isOfficeFile(file)) return null;

    const allPaperTypes = shopSettings.paperTypes && shopSettings.paperTypes.length > 0
      ? shopSettings.paperTypes
      : [
          { id: "normal", name: "Normal", nameAr: "عادي", colorPerPage: shopSettings.pricing?.colorPerPage ?? 30.0, blackWhitePerPage: shopSettings.pricing?.blackWhitePerPage ?? 15.0 },
          { id: "glossy", name: "Glossy", nameAr: "لامع", colorPerPage: shopSettings.pricing?.glossyPerPage ?? 50.0, blackWhitePerPage: shopSettings.pricing?.glossyPerPage ?? 50.0 },
          { id: "cardboard", name: "Cardboard", nameAr: "ورق مقوى", colorPerPage: shopSettings.pricing?.cardboardPerPage ?? 40.0, blackWhitePerPage: shopSettings.pricing?.cardboardPerPage ?? 40.0 },
        ];

    const paperType = allPaperTypes.find(pt => pt.id === (printPreferences.paperType || "normal"));
    const pricePerPage = paperType
      ? (printPreferences.colorMode === "blackWhite" ? paperType.blackWhitePerPage : paperType.colorPerPage)
      : (printPreferences.colorMode === "blackWhite" ? (shopSettings.pricing?.blackWhitePerPage ?? 15.0) : (shopSettings.pricing?.colorPerPage ?? 30.0));

    // Estimate page count (use actual count if available)
    const estimatedPages = fileId && filePageCounts[fileId]
      ? filePageCounts[fileId]
      : file.type.includes("pdf")
      ? Math.max(1, Math.ceil(file.size / 75000))
      : file.type.includes("image")
      ? 1
      : Math.max(1, Math.ceil(file.size / 50000));

    const totalPages = estimatedPages * printPreferences.copies;
    const originalPrice = pricePerPage * totalPages;

    // Debug logging
    console.log("Calculating discount for file:", file.name, {
      totalPages,
      originalPrice,
      discountRulesCount: discountRules?.length || 0,
      discountRules: discountRules,
    });

    // Calculate discount
    const discountResult = calculateJobDiscount(
      {} as PrintJob,
      originalPrice,
      totalPages,
      discountRules
    );

    console.log("Discount result:", discountResult);

    return {
      original: originalPrice,
      discount: discountResult.discountAmount,
      final: discountResult.finalAmount,
      hasDiscount: discountResult.discountAmount > 0,
      ruleName: discountResult.rule?.name,
    };
  };

  const handlePreviewJob = async (job: PrintJob) => {
    try {
      const url = await storageService.getFileUrl(shopSlug, job.id);
      if (url) setPreviewJob({ job, url });
    } catch (err) {
      console.error("Failed to fetch preview", err);
    }
  };

  

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length > 0) {
      const newFileStatuses: FileStatus[] = [];
      let hasError = false;

      for (const file of files) {
        if (!ALLOWED_TYPES.includes(file.type)) {
          setError(t("fileLimit"));
          hasError = true;
          break;
        }
        newFileStatuses.push({
          file,
          progress: 0,
          status: "pending",
          id: generateSafeId(),
        });
      }

      if (!hasError) {
        setSelectedFiles((prev) => [...prev, ...newFileStatuses]);
        setError(null);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeFile = (id: string) => {
    if (isUploading) return;
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const performUpload = async (
    fileStatus: FileStatus,
    name: string,
    phone: string,
    notes: string,
  ) => {
    const job: PrintJob = {
      id: generateSafeId(),
      customerName: name.trim(),
      phoneNumber: phone.trim(),
      notes: notes.trim(),
      fileName: fileStatus.file.name,
      fileType: fileStatus.file.type,
      fileSize: fileStatus.file.size,
      uploadDate: new Date().toISOString(),
      status: PrintStatus.PENDING,
      printPreferences: {
        colorMode: printPreferences.colorMode,
        copies: printPreferences.copies,
        paperType: printPreferences.paperType,
      },
    };

    setSelectedFiles((prev) =>
      prev.map((f) =>
        f.id === fileStatus.id ? { ...f, status: "uploading" } : f,
      ),
    );

    try {
      await storageService.saveJob(shopSlug, job, fileStatus.file, (progress) => {
        setSelectedFiles((prev) =>
          prev.map((f) => (f.id === fileStatus.id ? { ...f, progress } : f)),
        );
      });
      setSelectedFiles((prev) =>
        prev.map((f) =>
          f.id === fileStatus.id
            ? { ...f, status: "success", progress: 100 }
            : f,
        ),
      );
    } catch (err) {
      console.error("Upload error for file:", fileStatus.file.name, err);
      setSelectedFiles((prev) =>
        prev.map((f) =>
          f.id === fileStatus.id ? { ...f, status: "error" } : f,
        ),
      );
      throw err;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0) {
      setError(t("selectFile"));
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      for (const fileStatus of selectedFiles) {
        if (fileStatus.status === "success") continue;
        await performUpload(
          fileStatus,
          formData.name,
          formData.phone,
          formData.notes,
        );
      }
      setOverallSuccess(true);
    } catch (err) {
      setError(t("errorMsg"));
    } finally {
      setIsUploading(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const overallProgress = selectedFiles.length > 0
    ? Math.round(selectedFiles.reduce((sum, f) => sum + (f.status === "success" ? 100 : f.progress), 0) / selectedFiles.length)
    : 0;

  if (overallSuccess) {
    return (
      <>
        <style>{`
          @keyframes successPop {
            0% { transform: scale(0); opacity: 0; }
            60% { transform: scale(1.1); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes fadeSlideUp {
            0% { opacity: 0; transform: translateY(12px); }
            100% { opacity: 1; transform: translateY(0); }
          }
          .success-pop { animation: successPop 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards; }
          .fade-slide-up { animation: fadeSlideUp 0.4s ease forwards; }
        `}</style>
        <div className="max-w-md mx-auto mt-12">
          <div className="bg-white dark:bg-gray-800 p-10 rounded-3xl shadow-2xl shadow-indigo-100/60 dark:shadow-indigo-900/30 text-center border border-gray-100 dark:border-gray-800">
            <div className="success-pop w-20 h-20 mx-auto mb-5">
              <div className="w-20 h-20 bg-green-500 dark:bg-green-600 rounded-full flex items-center justify-center shadow-lg shadow-green-200 dark:shadow-green-900/30">
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>

            <div className="fade-slide-up" style={{ animationDelay: "0.15s", opacity: 0 }}>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                {isRtl ? "تم الإرسال!" : "Files Sent!"}
              </h2>
              <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm">
                {isRtl ? "وصلت ملفاتك إلى الطابعة بنجاح" : "Your files are on their way to the printer"}
              </p>
              <Button
                size="lg"
                className="w-full"
                onClick={() => {
                  setOverallSuccess(false);
                  setSelectedFiles([]);
                  setFormData({ name: "", phone: "", notes: "" });
                  setPrintPreferences({ colorMode: "color", copies: 1, paperType: shopSettings?.paperTypes?.[0]?.id || "normal" });
                }}
              >
                {isRtl ? "إرسال ملفات أخرى" : "Send more files"}
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className={`w-full max-w-3xl mx-auto px-3 sm:px-4 ${isRtl ? "rtl" : ""}`}>
      <div className="text-center mb-5">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
          {t("uploadTitle")}
        </h1>
        <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300">{t("uploadSub")}</p>
        <div className="mt-4 flex justify-center gap-3">
          {shopSettings && (shopSettings.phoneNumbers?.length > 0 || shopSettings.email || shopSettings.address) && (
            <Button
              variant="link"
              onClick={() => setStoreInfoOpen(true)}
              className="gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              {isRtl ? "معلومات المحل" : "Store Info"}
            </Button>
          )}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-gray-800 p-4 sm:p-6 lg:p-7 rounded-2xl shadow-xl shadow-indigo-100/40 dark:shadow-indigo-900/20 border border-white dark:border-gray-700 space-y-4 sm:space-y-5 mb-8"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
              {t("customerName")}{" "}
              <span className="text-gray-400 dark:text-gray-500 font-normal">
                ({isRtl ? "اختياري" : "Optional"})
              </span>
            </label>
            <Input
              disabled={isUploading}
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder={isRtl ? "مثال: محمد علي" : "e.g. John Doe"}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
              {t("phoneNumber")}{" "}
              <span className="text-gray-400 dark:text-gray-500 font-normal">
                ({isRtl ? "اختياري" : "Optional"})
              </span>
            </label>
            <Input
              type="tel"
              disabled={isUploading}
              value={formData.phone}
              onChange={(e) =>
                setFormData({ ...formData, phone: e.target.value })
              }
              placeholder={isRtl ? "05xxxxxxxx" : "05xxxxxxxx"}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
            {t("notes")}
          </label>
          <Textarea
            disabled={isUploading}
            value={formData.notes}
            onChange={(e) =>
              setFormData({ ...formData, notes: e.target.value })
            }
            placeholder={
              isRtl
                ? "أدخل تعليمات الطباعة الإضافية هنا..."
                : "Enter additional printing instructions here..."
            }
          />
        </div>

        {/* Print Preferences Section */}
        <div className="bg-gray-50 dark:bg-gray-900/50 p-6 rounded-2xl border border-gray-100 dark:border-gray-800">
          <label className="block text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4">
            {isRtl ? "تفضيلات الطباعة" : "Print Preferences"}
          </label>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Color Mode */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
                {isRtl ? "وضع الألوان" : "Color Mode"}
              </label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={printPreferences.colorMode === "color" ? "default" : "outline"}
                  disabled={isUploading}
                  onClick={() =>
                    setPrintPreferences({
                      ...printPreferences,
                      colorMode: "color",
                    })
                  }
                  className="flex-1"
                >
                  {isRtl ? "ملون" : "Color"}
                </Button>
                <Button
                  type="button"
                  variant={printPreferences.colorMode === "blackWhite" ? "default" : "outline"}
                  disabled={isUploading}
                  onClick={() =>
                    setPrintPreferences({
                      ...printPreferences,
                      colorMode: "blackWhite",
                    })
                  }
                  className="flex-1"
                >
                  {isRtl ? "أبيض وأسود" : "B&W"}
                </Button>
              </div>
            </div>

            {/* Number of Copies */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
                {isRtl ? "عدد النسخ" : "Number of Copies"}
              </label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={isUploading || printPreferences.copies <= 1}
                  onClick={() =>
                    setPrintPreferences({
                      ...printPreferences,
                      copies: Math.max(1, printPreferences.copies - 1),
                    })
                  }
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M20 12H4"
                    />
                  </svg>
                </Button>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  disabled={isUploading}
                  value={printPreferences.copies}
                  onChange={(e) => {
                    const value = parseInt(e.target.value) || 1;
                    setPrintPreferences({
                      ...printPreferences,
                      copies: Math.max(1, Math.min(100, value)),
                    });
                  }}
                  className="flex-1 text-center"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={isUploading || printPreferences.copies >= 100}
                  onClick={() =>
                    setPrintPreferences({
                      ...printPreferences,
                      copies: Math.min(100, printPreferences.copies + 1),
                    })
                  }
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </Button>
              </div>
            </div>
            </div>

            {/* Paper Type */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
                {isRtl ? "نوع الورق" : "Paper Type"}
              </label>
              <div className="flex flex-wrap gap-2">
                {(shopSettings?.paperTypes && shopSettings.paperTypes.length > 0
                  ? shopSettings.paperTypes
                  : [
                      { id: "normal", name: "Normal", nameAr: "عادي" },
                      { id: "glossy", name: "Glossy", nameAr: "لامع" },
                      { id: "cardboard", name: "Cardboard", nameAr: "ورق مقوى" },
                    ]
                ).map((pt) => (
                  <Button
                    key={pt.id}
                    type="button"
                    variant={printPreferences.paperType === pt.id ? "default" : "outline"}
                    disabled={isUploading}
                    onClick={() => setPrintPreferences({ ...printPreferences, paperType: pt.id })}
                    className="flex-1 min-w-[5rem]"
                  >
                    {isRtl ? pt.nameAr : pt.name}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="relative">
          <label className="block text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
            {t("selectFile")}
          </label>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
              const files = Array.from(e.dataTransfer.files);
              if (files.length > 0) {
                const newFileStatuses: FileStatus[] = [];
                let hasError = false;
                for (const file of files) {
                  if (!ALLOWED_TYPES.includes(file.type)) {
                    setError(t("fileLimit"));
                    hasError = true;
                    break;
                  }
                  newFileStatuses.push({
                    file,
                    progress: 0,
                    status: "pending",
                    id: generateSafeId(),
                  });
                }
                if (!hasError) {
                  setSelectedFiles((prev) => [...prev, ...newFileStatuses]);
                  setError(null);
                }
              }
            }}
            className={`border-2 border-dashed rounded-xl p-5 sm:p-8 text-center cursor-pointer transition-all active:scale-[0.99] touch-manipulation ${
              isDragging
                ? "border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20"
                : "border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              multiple
              accept=".pdf,.docx,.xlsx,.xls,.ppt,.pptx,.jpg,.jpeg,.png,image/jpeg,image/png"
            />
            <div className="flex flex-col items-center gap-1 sm:gap-2">
              <svg
                className="w-8 h-8 sm:w-10 sm:h-10 text-gray-400 dark:text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                ></path>
              </svg>
              <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 font-medium">
                {t("dragDrop")}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("fileLimit")}</p>
            </div>
          </div>
        </div>

        {selectedFiles.length > 0 && (
          <div className="space-y-3 mt-4">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {isRtl ? "الملفات المختارة" : "Selected Files"} (
              {selectedFiles.length})
            </h3>
            {selectedFiles.map((fileStatus) => (
              <div
                key={fileStatus.id}
                className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
                    <svg
                      className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      ></path>
                    </svg>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm font-medium text-gray-900 dark:text-gray-100 break-words leading-snug">
                        {fileStatus.file.name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex flex-wrap gap-x-2">
                        <span>{formatSize(fileStatus.file.size)}</span>
                        {(() => {
                          const priceInfo = getFilePriceWithDiscount(fileStatus.file, fileStatus.id);
                          if (priceInfo === null && isOfficeFile(fileStatus.file)) {
                            return <span className="text-red-500 dark:text-red-400 text-[10px]">{isRtl ? "لا يمكن حساب الصفحات" : "Can't count pages"}</span>;
                          }
                          if (!priceInfo) return null;
                          return priceInfo.hasDiscount ? (
                            <span className="text-green-600 dark:text-green-400 font-medium text-[11px]">
                              <span className="line-through text-gray-400 dark:text-gray-500 mr-1">{priceInfo.original.toFixed(0)} DZD</span>
                              {priceInfo.final.toFixed(0)} DZD
                              <span className="text-[10px] ml-0.5">(-{priceInfo.discount.toFixed(0)})</span>
                            </span>
                          ) : (
                            <span className="text-gray-600 dark:text-gray-300">{priceInfo.original.toFixed(0)} DZD</span>
                          );
                        })()}
                      </p>
                    </div>
                  </div>
                  {!isUploading && fileStatus.status !== "success" && (
                    <button
                      type="button"
                      onClick={() => removeFile(fileStatus.id)}
                      className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 p-1 -m-1 flex-shrink-0"
                      aria-label="Remove file"
                    >
                      <svg
                        className="w-4 h-4 sm:w-5 sm:h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M6 18L18 6M6 6l12 12"
                        ></path>
                      </svg>
                    </button>
                  )}
                  {fileStatus.status === "success" && (
                    <svg
                      className="w-4 h-4 sm:w-5 sm:h-5 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M5 13l4 4L19 7"
                      ></path>
                    </svg>
                  )}
                  {fileStatus.status === "error" && (
                    <svg
                      className="w-4 h-4 sm:w-5 sm:h-5 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      ></path>
                    </svg>
                  )}
                </div>
                {fileStatus.status === "uploading" && (
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-2 overflow-hidden">
                    <div
                      className="bg-indigo-600 h-1.5 transition-all duration-300"
                      style={{ width: `${fileStatus.progress}%` }}
                    />
                  </div>
                )}
              </div>
            ))}

            {/* Total Price Summary with Discounts */}
            {selectedFiles.length > 0 && shopSettings?.pricing && (
              <div className="mt-4 p-3 sm:p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/30 rounded-xl">
                {(() => {
                  let totalOriginal = 0;
                  let totalDiscount = 0;
                  let totalFinal = 0;

                  selectedFiles.forEach((fileStatus) => {
                    const priceInfo = getFilePriceWithDiscount(fileStatus.file, fileStatus.id);
                    if (priceInfo) {
                      totalOriginal += priceInfo.original;
                      totalDiscount += priceInfo.discount;
                      totalFinal += priceInfo.final;
                    }
                  });

                  const hasDiscount = totalDiscount > 0;

                  return (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600 dark:text-gray-300">
                          {isRtl ? "المجموع الفرعي" : "Subtotal"}
                        </span>
                        <span className="font-semibold text-gray-900 dark:text-gray-100">
                          {totalOriginal.toFixed(0)} DZD
                        </span>
                      </div>
                      {hasDiscount && (
                        <div className="flex justify-between items-center text-green-600 dark:text-green-400">
                          <span className="text-sm">
                            {isRtl ? "الخصم" : "Discount"}
                          </span>
                          <span className="font-semibold">
                            -{totalDiscount.toFixed(0)} DZD
                          </span>
                        </div>
                      )}
                      <div className="border-t border-indigo-200 pt-2 flex justify-between items-center">
                        <span className="text-base font-bold text-gray-900 dark:text-gray-100">
                          {isRtl ? "الإجمالي" : "Total"}
                        </span>
                        <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                          {totalFinal.toFixed(0)} DZD
                        </span>
                      </div>
                      {hasDiscount && (
                        <p className="text-xs text-green-600 dark:text-green-400 text-center mt-2">
                          {isRtl
                            ? `وفرت ${totalDiscount.toFixed(0)} DZD!`
                            : `You saved ${totalDiscount.toFixed(0)} DZD!`}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-xs sm:text-sm border border-red-100 dark:border-red-800/30 leading-relaxed">
            {error}
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          disabled={isUploading || selectedFiles.length === 0}
          className="w-full gap-2 text-base sm:text-lg py-3 sm:py-4 shadow-xl shadow-indigo-600/20 dark:shadow-indigo-400/20"
        >
          {isUploading ? (
            <svg
              className="animate-spin h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          ) : (
            <>
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                ></path>
              </svg>
              {t("uploadBtn")}
            </>
          )}
        </Button>
      </form>

      {/* Recent Uploads Section */}
      {recentJobs.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100">
              {t("recentUploads")}
            </h2>
          </div>
          <div className="grid gap-2 sm:gap-3">
            {recentJobs.map((job) => (
              <Card key={job.id}>
                <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  {/* File type icon */}
                  <div className="w-7 h-7 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                    {job.fileType.includes("pdf") ? (
                      <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        <text x="12" y="16" textAnchor="middle" fontSize="7" fontWeight="bold" fill="currentColor">PDF</text>
                      </svg>
                    ) : job.fileType.includes("word") || job.fileType.includes("document") ? (
                      <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        <text x="12" y="16" textAnchor="middle" fontSize="6" fontWeight="bold" fill="currentColor">DOC</text>
                      </svg>
                    ) : job.fileType.includes("excel") || job.fileType.includes("spreadsheet") ? (
                      <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        <text x="12" y="16" textAnchor="middle" fontSize="6" fontWeight="bold" fill="currentColor">XLS</text>
                      </svg>
                    ) : job.fileType.includes("image") ? (
                      <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    )}
                  </div>
                  <div
                    className={`w-7 h-7 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 ${job.status === PrintStatus.PRINTED
                      ? "bg-green-100 text-green-600 dark:text-green-400"
                      : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"
                      }`}
                  >
                    {job.status === PrintStatus.PRINTED ? (
                      <svg
                        className="w-4 h-4 sm:w-5 sm:h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M5 13l4 4L19 7"
                        ></path>
                      </svg>
                    ) : (
                      <svg
                        className="w-4 h-4 sm:w-5 sm:h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        ></path>
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-gray-100 truncate max-w-[140px] sm:max-w-[240px] md:max-w-sm text-sm sm:text-base">
                      {job.fileName}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 mt-0.5 flex-wrap">
                      <p>
                        {new Date(job.uploadDate).toLocaleDateString(
                          isRtl ? "ar-EG" : "en-US",
                          { numberingSystem: "latn" },
                        )}
                      </p>
                      {jobPageCounts[job.id] && !isOfficeType(job.fileType) ? (
                        <>
                          <span className="w-1 h-1 rounded-full bg-gray-300 hidden sm:inline-block"></span>
                          <p className="flex items-center gap-1 font-medium bg-gray-100 dark:bg-gray-800/80 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded text-[10px] sm:text-xs">
                            <svg
                              className="w-3 h-3 text-gray-400 dark:text-gray-500"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                              ></path>
                            </svg>
                            {jobPageCounts[job.id]} {isRtl ? "صفحات" : "Pages"}
                          </p>
                        </>
                      ) : null}
                      {job.printPreferences && (
                        <>
                          <span className="w-1 h-1 rounded-full bg-gray-300 hidden sm:inline-block"></span>
                          <span className="flex items-center gap-1 text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                            </svg>
                            {job.printPreferences.colorMode === "blackWhite" ? (isRtl ? "أبيض وأسود" : "B&W") : (isRtl ? "ملون" : "Color")}
                          </span>
                          <span className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">
                            {job.printPreferences.copies}x
                          </span>
                          <span className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 capitalize">
                            {(() => {
                              const pt = (shopSettings?.paperTypes || []).find(p => p.id === job.printPreferences?.paperType);
                              if (pt) return isRtl ? pt.nameAr : pt.name;
                              switch (job.printPreferences?.paperType) {
                                case "glossy": return isRtl ? "لامع" : "Glossy";
                                case "cardboard": return isRtl ? "مقوى" : "Cardboard";
                                default: return isRtl ? "عادي" : "Normal";
                              }
                            })()}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <div className="flex items-center gap-2">
                    {(shopSettings?.pricing || (shopSettings?.paperTypes && shopSettings.paperTypes.length > 0)) && !!jobPageCounts[job.id] && !isOfficeType(job.fileType) && (() => {
                      const basePrice = calculatePrintPrice(job, shopSettings, jobPageCounts[job.id] || 1).totalPrice;
                      const discountResult = calculateJobDiscount(job, basePrice, jobPageCounts[job.id] || 1, discountRules);
                      const hasDiscount = discountResult.discountAmount > 0;
                      return (
                        <span className={`text-sm font-black px-2.5 py-1 rounded-md border shadow-sm dark:shadow-gray-900/50 whitespace-nowrap tracking-tight ${hasDiscount ? "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800/30" : "text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/20 border-green-200 dark:border-green-800/30"}`}>
                          {hasDiscount ? (
                            <span className="flex items-center gap-1.5">
                              <span className="line-through text-gray-400 dark:text-gray-500 text-[10px]">{formatPrice(basePrice)}</span>
                              <span>{formatPrice(discountResult.finalAmount)}</span>
                              <span className="text-[10px] bg-green-200 dark:bg-green-800/40 text-green-800 dark:text-green-300 px-1 py-0.5 rounded">-{discountResult.discountAmount.toFixed(0)} DZD</span>
                            </span>
                          ) : (
                            formatPrice(basePrice)
                          )}
                        </span>
                      );
                    })()}
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${job.status === PrintStatus.PRINTED
                        ? "bg-green-100 text-green-700 dark:text-green-400"
                        : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                        }`}
                    >
                      {job.status === PrintStatus.PRINTED
                        ? t("printed")
                        : t("pending")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handlePreviewJob(job)}
                      title={isRtl ? "معاينة" : "Preview"}
                      className="p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-400 text-gray-400 dark:text-gray-500 transition-colors"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    </button>
                    {job.status === PrintStatus.PENDING && (
                      <button
                        type="button"
                        onClick={() => handleCancelJob(job.id)}
                        title={isRtl ? "إلغاء طباعة" : "Cancel print"}
                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 dark:hover:text-red-400 text-gray-400 dark:text-gray-500 transition-colors"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
            ))}
          </div>
          {shopSettings?.pricing && (
            <div className="p-3 bg-blue-50/50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800/30 flex items-start gap-3 mt-4">
              <svg
                className="w-5 h-5 text-blue-500 dark:text-blue-400 mt-0.5 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-xs text-blue-700 dark:text-blue-400 font-medium">
                {isRtl
                  ? "ملاحظة: السعر المعروض تقريبي. قد يتغير السعر النهائي حسب إعدادات المتجر الفعلية وحجم وألوان المستند النهائية التي يتم طباعتها."
                  : "Note: The estimated price is approximate. The final price may change slightly depending on the exact dimensions, color ink coverage, and store verification."}
              </p>
            </div>
          )}
        </div>
      )}

      <PreviewModal
        open={previewJob !== null}
        onClose={() => setPreviewJob(null)}
        url={previewJob?.url ?? null}
        fileName={previewJob?.job.fileName ?? ""}
        fileType={previewJob?.job.fileType}
        fileSize={previewJob?.job.fileSize}
      />

      {/* Upload Overlay */}
      {isUploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 animate-in fade-in duration-200"
          style={{ background: "rgba(10,10,25,0.6)", backdropFilter: "blur(8px)" }}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm text-center animate-in zoom-in-95 duration-200">
            {/* Progress ring */}
            <div className="relative mx-auto mb-3 w-16 h-16">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="#e0e7ff" strokeWidth="7" />
                <circle
                  cx="40" cy="40" r="34"
                  fill="none"
                  stroke="#6366f1"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray="214"
                  strokeDashoffset={Math.max(4, 214 - (214 * overallProgress / 100))}
                  style={{ transition: "stroke-dashoffset 0.5s cubic-bezier(0.4, 0, 0.2, 1)" }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold text-indigo-700 dark:text-indigo-400 transition-all duration-300">{overallProgress}%</span>
              </div>
            </div>

            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">
              {isRtl ? "جاري الإرسال..." : "Uploading..."}
            </p>

            {/* Progress bar */}
            <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden mb-5 relative">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all duration-500 ease-out"
                style={{ width: `${Math.max(overallProgress, 4)}%` }}
              />
            </div>

            {/* File list (names + status only) */}
            <div className="space-y-1.5 text-left max-h-32 overflow-y-auto">
              {selectedFiles.map(f => (
                <div key={f.id} className="flex items-center gap-2">
                  {f.status === "success" ? (
                    <div className="w-3.5 h-3.5 rounded-full bg-green-500 dark:bg-green-600 flex items-center justify-center flex-shrink-0 animate-in fade-in duration-200">
                      <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : f.status === "uploading" ? (
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin flex-shrink-0" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-200 dark:border-gray-700 flex-shrink-0" />
                  )}
                  <span className={`text-xs truncate ${f.status === "success" ? "text-green-700 dark:text-green-400 font-medium" : f.status === "error" ? "text-red-600 dark:text-red-400" : "text-gray-600 dark:text-gray-300"}`}>
                    {f.file.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={cancelConfirm.isOpen} onOpenChange={(open) => { if (!open) setCancelConfirm({ isOpen: false, jobId: null }); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isRtl ? "حذف هذا الملف؟" : "Delete this file?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isRtl
                ? "سيتم حذف هذا الملف بشكل دائم. لا يمكن التراجع عن هذا الإجراء."
                : "This file will be permanently deleted. This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={(e) => e.stopPropagation()}>{isRtl ? "إلغاء" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancelJob} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isRtl ? "حذف" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Store Info Dialog */}
      <Dialog open={storeInfoOpen} onOpenChange={setStoreInfoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{shopSettings?.shopName || "PrintShop Hub"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {shopSettings?.phoneNumbers && shopSettings.phoneNumbers.length > 0 && (
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{isRtl ? "أرقام الهاتف" : "Phone Numbers"}</label>
                <div className="mt-1 space-y-2">
                  {shopSettings.phoneNumbers.map((num, i) => (
                    <div key={i} className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                      <span dir="ltr" className="text-sm text-gray-900 dark:text-gray-100">{num}</span>
                      <button
                        type="button"
                        onClick={() => { navigator.clipboard.writeText(num); toast({ title: isRtl ? "تم النسخ" : "Copied" }); }}
                        className="p-1.5 text-gray-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
                        title={isRtl ? "نسخ" : "Copy"}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {shopSettings?.email && (
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{isRtl ? "البريد الإلكتروني" : "Email"}</label>
                <div className="mt-1 flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                  <span className="text-sm text-gray-900 dark:text-gray-100">{shopSettings.email}</span>
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard.writeText(shopSettings.email!); toast({ title: isRtl ? "تم النسخ" : "Copied" }); }}
                    className="p-1.5 text-gray-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
                    title={isRtl ? "نسخ" : "Copy"}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
            {shopSettings?.address && (
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{isRtl ? "العنوان" : "Address"}</label>
                <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">{shopSettings.address}</p>
              </div>
            )}
            {shopSettings?.workingHours && (
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{isRtl ? "ساعات العمل" : "Working Hours"}</label>
                <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">{shopSettings.workingHours}</p>
              </div>
            )}
            {shopSettings?.returnPolicy && (
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{isRtl ? "سياسة الإرجاع" : "Return Policy"}</label>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{shopSettings.returnPolicy}</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Toaster for notifications */}
      <Toaster />
    </div>
  );
};

export default UploadView;
