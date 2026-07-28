import { PrintJob, ShopSettings, DiscountRule, AccountProfile, AccountOrder } from "../types";

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

  private myJobIdsKey(shopSlug: string): string {
    return `my_upload_ids_${shopSlug}`;
  }

  async saveJob(
    shopSlug: string,
    job: PrintJob,
    file: File,
    onProgress?: (p: number) => void,
    accessToken?: string | null,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("metadata", JSON.stringify(job));

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/s/${shopSlug}/upload`, true);
      xhr.setRequestHeader("Accept", "application/json");
      if (accessToken) {
        xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
      }

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
            const myJobs = this.getMyJobIds(shopSlug);
            myJobs.push(response.job.id);
            localStorage.setItem(this.myJobIdsKey(shopSlug), JSON.stringify(myJobs));
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

  getMyJobIds(shopSlug: string): string[] {
    try {
      const data = localStorage.getItem(this.myJobIdsKey(shopSlug));
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  async getMyRecentJobs(shopSlug: string): Promise<Partial<PrintJob>[]> {
    try {
      const myIds = this.getMyJobIds(shopSlug);
      if (myIds.length === 0) return [];
      const data = await this.safeFetch(`/api/s/${shopSlug}/orders/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: myIds }),
      });
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async getFileUrl(shopSlug: string, id: string): Promise<string | null> {
    return `/api/s/${shopSlug}/files/public/${id}`;
  }

  async deleteJob(shopSlug: string, id: string): Promise<void> {
    const myJobs = this.getMyJobIds(shopSlug);
    await this.safeFetch(`/api/s/${shopSlug}/orders/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ myIds: myJobs }),
    });
    localStorage.setItem(this.myJobIdsKey(shopSlug), JSON.stringify(myJobs.filter((mid) => mid !== id)));
  }

  async getSettings(shopSlug: string): Promise<ShopSettings> {
    try {
      const settings = await this.safeFetch(`/api/s/${shopSlug}/settings`);
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

  async getPaperTypes(shopSlug: string): Promise<import("../types").PaperType[]> {
    return this.safeFetch(`/api/s/${shopSlug}/paper-types`);
  }

  async getActiveDiscountRules(shopSlug: string): Promise<DiscountRule[]> {
    return this.safeFetch(`/api/s/${shopSlug}/discount-rules/active`);
  }

  // ── Customer account (optional — requires a Supabase access token) ──

  async getAccountProfile(accessToken: string): Promise<AccountProfile> {
    return this.safeFetch("/api/account/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  async updateAccountProfile(accessToken: string, fields: Partial<AccountProfile>): Promise<AccountProfile> {
    return this.safeFetch("/api/account/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(fields),
    });
  }

  async getAccountOrders(accessToken: string): Promise<AccountOrder[]> {
    const data = await this.safeFetch("/api/account/orders", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return Array.isArray(data) ? data : [];
  }
}

export const storageService = new StorageService();
