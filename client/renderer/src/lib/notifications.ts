import { toast } from "sonner";

type NotificationTone = "info" | "success" | "warning" | "error";
const DEDUPE_WINDOW_MS = 1_200;
const MAX_TITLE_LENGTH = 44;
const MAX_DESCRIPTION_LENGTH = 240;
let lastNotification: { key: string; createdAt: number } | null = null;

export interface NotifyOptions {
  title: string;
  description?: string;
  tone?: NotificationTone;
}

export function notify({
  title,
  description,
  tone = "info",
}: NotifyOptions): void {
  const shownTitle = truncateText(title, MAX_TITLE_LENGTH);
  const shownDescription = truncateDescription(description);
  const key = `${tone}:${shownTitle}:${shownDescription ?? ""}`;
  const now = Date.now();
  if (
    lastNotification?.key === key &&
    now - lastNotification.createdAt < DEDUPE_WINDOW_MS
  )
    return;
  lastNotification = { key, createdAt: now };

  const options = {
    description: shownDescription,
    className: `marloues-toast marloues-toast-${tone}`,
  };
  if (tone === "success") {
    toast.success(shownTitle, options);
    return;
  }
  if (tone === "warning") {
    toast.warning(shownTitle, options);
    return;
  }
  if (tone === "error") {
    toast.error(shownTitle, options);
    return;
  }
  toast(shownTitle, options);
}

function truncateDescription(
  description: string | undefined,
): string | undefined {
  return description
    ? truncateText(description, MAX_DESCRIPTION_LENGTH)
    : undefined;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}
