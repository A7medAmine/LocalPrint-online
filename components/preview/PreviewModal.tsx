import React from "react";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import FilePreview from "./FilePreview";
import { formatFileSize } from "../../utils/filePreview";

interface PreviewModalProps {
  open: boolean;
  onClose: () => void;
  url: string | null;
  fileName: string;
  fileType?: string;
  fileSize?: number;
  loading?: boolean;
}

const PreviewModal: React.FC<PreviewModalProps> = ({
  open,
  onClose,
  url,
  fileName,
  fileType,
  fileSize,
  loading,
}) => {
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-5xl w-[95vw] h-[85vh] flex flex-col p-0 gap-0 rounded-2xl">
        <div className="flex items-center justify-between px-5 pr-14 py-3 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-sm font-bold truncate">{fileName}</DialogTitle>
              {(fileType || fileSize) && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {fileType && <span>{fileType}</span>}
                  {fileType && fileSize && <span> &middot; </span>}
                  {fileSize && <span>{formatFileSize(fileSize)}</span>}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {url && (
              <a
                href={url}
                download
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                title="Download file"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </a>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          <FilePreview url={url} fileName={fileName} fileType={fileType} loading={loading} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PreviewModal;
