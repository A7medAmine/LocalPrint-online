import { PrintJob, ShopSettings, DiscountRule } from "../types";

class StorageService {
  private async safeFetch(url: string, options?: RequestInit) {
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      const response = await fetch(url, {
        ...options,
        headers: {
          ...headers,
          ...(options?.headers as Record<string, string> || {}),
        },
      });

      const text = await response.text();

      if (!response.ok) {
        let msg = `Server error: ${response.status}`;
        try { const errBody = JSON.parse(text); if (errBody.error) msg = errBody.error; } catch {}
        throw new Error(msg);
      }

      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        console.error("Failed to parse JSON response:", text);
        throw new Error("Malformed JSON response from server");
      }
    } catch (err) {
      console.error(`Fetch failed for ${url}:`, err);
      throw err;
    }
  }

  async saveJob(
    job: PrintJob,
    file: File,
    onProgress?: (p: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("metadata", JSON.stringify(job));

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload", true);
      xhr.setRequestHeader("Accept", "application/json");

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            onProgress(percent);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            const myJobs = this.getMyJobIds();
            myJobs.push(response.job.id);
            localStorage.setItem("my_upload_ids", JSON.stringify(myJobs));
            resolve();
          } catch (e) {
            reject(new Error("Malformed response from server"));
          }
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(formData);
    });
  }

  getMyJobIds(): string[] {
    try {
      const data = localStorage.getItem("my_upload_ids");
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  async getMyRecentJobs(): Promise<Partial<PrintJob>[]> {
    try {
      const myIds = this.getMyJobIds();
      if (myIds.length === 0) return [];
      const data = await this.safeFetch("/api/orders/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: myIds }),
      });
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async getFileUrl(id: string): Promise<string | null> {
    return `/api/files/public/${id}`;
  }

  async deleteJob(id: string): Promise<void> {
    const myJobs = this.getMyJobIds();
    await this.safeFetch(`/api/orders/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ myIds: myJobs }),
    });
    localStorage.setItem("my_upload_ids", JSON.stringify(myJobs.filter((mid) => mid !== id)));
  }

  async getSettings(): Promise<ShopSettings> {
    try {
      const settings = await this.safeFetch("/api/settings");
      const pricing = settings?.pricing
        ? {
            colorPerPage: Number(settings.pricing.colorPerPage) || 30.0,
            blackWhitePerPage: Number(settings.pricing.blackWhitePerPage) || 15.0,
            glossyPerPage: Number(settings.pricing.glossyPerPage) || 50.0,
            cardboardPerPage: Number(settings.pricing.cardboardPerPage) || 40.0,
          }
        : undefined;

      const defaultPaperTypes = [
        { id: "normal", name: "Normal", nameAr: "عادي", colorPerPage: pricing?.colorPerPage ?? 30.0, blackWhitePerPage: pricing?.blackWhitePerPage ?? 15.0 },
        { id: "glossy", name: "Glossy", nameAr: "لامع", colorPerPage: pricing?.glossyPerPage ?? 50.0, blackWhitePerPage: pricing?.glossyPerPage ?? 50.0 },
        { id: "cardboard", name: "Cardboard", nameAr: "ورق مقوى", colorPerPage: pricing?.cardboardPerPage ?? 40.0, blackWhitePerPage: pricing?.cardboardPerPage ?? 40.0 },
      ];

      return {
        shopName: settings?.shopName || "PrintShop Hub",
        logoUrl: settings?.logoUrl || null,
        pricing,
        paperTypes: Array.isArray(settings?.paperTypes) && settings.paperTypes.length > 0
          ? settings.paperTypes
          : defaultPaperTypes,
        phoneNumbers: Array.isArray(settings?.phoneNumbers) ? settings.phoneNumbers : undefined,
        email: settings?.email || undefined,
        address: settings?.address || undefined,
        workingHours: settings?.workingHours || undefined,
        returnPolicy: settings?.returnPolicy || undefined,
      };
    } catch {
      return { shopName: "PrintShop Hub", logoUrl: null, phoneNumbers: [], email: "", address: "", workingHours: "", returnPolicy: "" };
    }
  }

  async getPaperTypes(): Promise<import("../types").PaperType[]> {
    return this.safeFetch("/api/paper-types");
  }

  async getActiveDiscountRules(): Promise<DiscountRule[]> {
    return this.safeFetch("/api/discount-rules/active");
  }
}

export const storageService = new StorageService();
