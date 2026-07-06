export const formatRelativeTime = (dateStr: string, lang: "en" | "ar"): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (lang === "ar") {
    if (minutes < 1) return "الآن";
    if (minutes === 1) return "منذ دقيقة";
    if (minutes < 60) return `منذ ${minutes} دقيقة`;
    if (hours === 1) return "منذ ساعة";
    if (hours < 24) return `منذ ${hours} ساعات`;
    if (days === 1) return "أمس";
    if (days < 7) return `منذ ${days} أيام`;
    return date.toLocaleDateString("ar-DZ");
  } else {
    if (minutes < 1) return "Just now";
    if (minutes === 1) return "1 min ago";
    if (minutes < 60) return `${minutes} min ago`;
    if (hours === 1) return "1 hour ago";
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
};
