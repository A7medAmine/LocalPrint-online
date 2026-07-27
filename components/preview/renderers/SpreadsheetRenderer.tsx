import React, { useState, useEffect, useCallback } from "react";

interface SpreadsheetRendererProps {
  src: string;
  fileName: string;
}

interface SheetData {
  name: string;
  rows: string[][];
}

const SpreadsheetRenderer: React.FC<SpreadsheetRendererProps> = ({ src, fileName }) => {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const XLSX = await import("xlsx");
        const response = await fetch(src);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        if (cancelled) return;

        const workbook = XLSX.read(data, { type: "array" });
        const parsed: SheetData[] = workbook.SheetNames.map((name: string) => {
          const sheet = workbook.Sheets[name];
          const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            defval: "",
          });
          return { name, rows };
        });

        if (cancelled) return;
        setSheets(parsed);
        setActiveSheet(0);
        setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Failed to load spreadsheet");
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [src]);

  const switchSheet = useCallback((index: number) => {
    setActiveSheet(index);
  }, []);

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

  const current = sheets[activeSheet];

  if (!current || current.rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[300px] text-gray-400 dark:text-gray-500">
        <p className="text-sm font-medium">Empty spreadsheet</p>
      </div>
    );
  }

  const headerRow = current.rows[0];
  const dataRows = current.rows.slice(1);

  return (
    <div className="flex flex-col h-full">
      {sheets.length > 1 && (
        <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-100 dark:border-gray-700 overflow-x-auto shrink-0 scrollbar-none">
          {sheets.map((sheet, i) => (
            <button
              key={sheet.name}
              onClick={() => switchSheet(i)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                i === activeSheet
                  ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {headerRow.map((cell, i) => (
                <th
                  key={i}
                  className="sticky top-0 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 font-semibold px-3 py-2.5 text-left border-b-2 border-gray-200 dark:border-gray-600 whitespace-nowrap"
                >
                  {cell || ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataRows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors"
              >
                {Array.from({ length: Math.max(headerRow.length, row.length) }).map(
                  (_, colIdx) => (
                    <td
                      key={colIdx}
                      className="px-3 py-2 text-gray-600 dark:text-gray-400 border-r border-gray-50 dark:border-gray-800 last:border-r-0 truncate max-w-[200px]"
                    >
                      {row[colIdx] || ""}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SpreadsheetRenderer;
