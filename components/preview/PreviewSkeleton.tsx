import React from "react";

const PreviewSkeleton: React.FC = () => (
  <div className="flex items-center justify-center h-full min-h-[300px]">
    <div className="flex flex-col items-center gap-4 animate-pulse">
      <div className="w-14 h-14 rounded-xl bg-gray-200 dark:bg-gray-700" />
      <div className="h-3 w-32 rounded-full bg-gray-200 dark:bg-gray-700" />
      <div className="h-2.5 w-48 rounded-full bg-gray-100 dark:bg-gray-600" />
    </div>
  </div>
);

export default PreviewSkeleton;
