import React from "react";
import { detectFileType, FileType } from "../../utils/filePreview";
import ImageRenderer from "./renderers/ImageRenderer";
import PreviewSkeleton from "./PreviewSkeleton";

interface FilePreviewProps {
  url: string | null;
  fileName: string;
  fileType?: string;
  loading?: boolean;
}

const FilePreview: React.FC<FilePreviewProps> = ({ url, fileName, fileType, loading }) => {
  if (loading || !url) return <PreviewSkeleton />;

  const type: FileType = detectFileType(fileName, fileType);

  if (type === "image") {
    return <ImageRenderer src={url} fileName={fileName} />;
  }

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-gray-400 gap-4">
      <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
      </svg>
      <div className="text-center">
        <p className="text-sm font-medium">Preview not available</p>
        <p className="text-xs text-gray-400 mt-1">
          {fileType || fileName.split(".").pop()?.toUpperCase() || "Unknown"} files cannot be previewed
        </p>
      </div>
      <a
        href={url}
        download
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        Download File
      </a>
    </div>
  );
};

export default FilePreview;
