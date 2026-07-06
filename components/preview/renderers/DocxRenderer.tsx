import React, { useState, useEffect, useRef } from "react";
import { sanitizeHtml } from "../../../utils/filePreview";

interface DocxRendererProps {
  src: string;
  fileName: string;
}

const DocxRenderer: React.FC<DocxRendererProps> = ({ src, fileName }) => {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function convert() {
      try {
        setLoading(true);
        setError(null);

        const mammoth = await import("mammoth");
        const response = await fetch(src);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();

        if (cancelled) return;

        const result = await mammoth.convertToHtml({ arrayBuffer });
        const sanitized = sanitizeHtml(result.value);

        if (cancelled) return;
        setHtml(sanitized);
        setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Failed to load document");
          setLoading(false);
        }
      }
    }

    convert();
    return () => { cancelled = true; };
  }, [src]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-gray-400 dark:text-gray-500 gap-3">
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <p className="text-sm font-medium">{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[300px]">
        <div className="flex flex-col items-center gap-4 animate-pulse">
          <div className="w-14 h-14 rounded-xl bg-gray-200 dark:bg-gray-700" />
          <div className="h-3 w-32 rounded-full bg-gray-200 dark:bg-gray-700" />
          <div className="h-2.5 w-48 rounded-full bg-gray-100 dark:bg-gray-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-white dark:bg-gray-900 p-6 sm:p-10">
      <div
        ref={containerRef}
        className="prose prose-sm max-w-none prose-headings:text-gray-900 dark:prose-headings:text-gray-100 prose-p:text-gray-700 dark:prose-p:text-gray-300 prose-a:text-indigo-600 dark:prose-a:text-indigo-400 prose-img:rounded-lg prose-strong:text-gray-900 dark:prose-strong:text-gray-100"
        dangerouslySetInnerHTML={{ __html: html || "" }}
      />
    </div>
  );
};

export default DocxRenderer;
