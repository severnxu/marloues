import type { WorkspaceInfo } from "@shared/types";
import { workspacePathsEqual } from "@shared/workspace-path";

export type WorkAreaId = "daily";

export interface WorkAreaGroup<T> {
  key: string;
  name: string;
  path: string;
  items: T[];
}

export function getWorkAreaProjectName(
  path: string,
  projects: readonly WorkspaceInfo[],
): string {
  const project = projects.find((item) => workspacePathsEqual(item.path, path));
  if (project) return project.name;

  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || "未命名项目";
}

export function formatSidebarTimestamp(
  timestamp: number,
  now = Date.now(),
): string {
  const value = new Date(timestamp);
  const today = new Date(now);
  const dayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const valueDayStart = new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  ).getTime();
  const dayOffset = Math.round((dayStart - valueDayStart) / 86_400_000);

  if (dayOffset === 0) {
    return value.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  if (dayOffset === 1) return "昨天";
  if (dayOffset > 1 && dayOffset < 7) {
    return `周${"日一二三四五六"[value.getDay()]}`;
  }
  return `${value.getMonth() + 1}/${value.getDate()}`;
}
