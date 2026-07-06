export type FileType = "pdf" | "docx" | "xlsx" | "image" | "unsupported";

const MIME_MAP: Record<string, FileType> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

const EXT_MAP: Record<string, FileType> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  xls: "xlsx",
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  bmp: "image",
  webp: "image",
  svg: "image",
  tiff: "image",
  tif: "image",
};

export function detectFileType(fileName: string, mimeType?: string): FileType {
  if (mimeType && MIME_MAP[mimeType]) return MIME_MAP[mimeType];
  if (mimeType?.startsWith("image/")) return "image";
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return EXT_MAP[ext] || "unsupported";
}

export function isFileTypeSupported(fileName: string, mimeType?: string): boolean {
  return detectFileType(fileName, mimeType) !== "unsupported";
}

export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<[^>]*\bon\w+\s*=[^>]*>/gi, "")
    .replace(/<[^>]*\bjavascript\s*:[^>]*>/gi, "")
    .replace(/<[^>]*\bdata\s*:\s*text\/html[^>]*>/gi, "")
    .replace(/on\w+\s*=\s*[^'"\s][^\s>]*/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/<\/?\s*(script|iframe|embed|object|applet|base|meta|link|style|form|input|button|textarea|select|option)\b[^>]*>/gi, "");
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
