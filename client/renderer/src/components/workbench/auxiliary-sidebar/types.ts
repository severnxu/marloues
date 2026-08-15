import type { LucideIcon } from "lucide-react";

export type AuxiliaryStaticViewType = "outputs" | "files" | "memory" | "review";

export interface AuxiliaryViewOption {
  type: AuxiliaryStaticViewType;
  label: string;
  icon: LucideIcon;
}

export interface AuxiliaryHeaderTab {
  id: string;
  label: string;
  icon: LucideIcon;
  selected: boolean;
}

function auxiliaryDomKey(id: string): string {
  return encodeURIComponent(id).replaceAll("%", "_");
}

export function auxiliaryTabDomId(id: string): string {
  return `auxiliary-tab-${auxiliaryDomKey(id)}`;
}

export function auxiliaryPanelDomId(id: string): string {
  return `auxiliary-panel-${auxiliaryDomKey(id)}`;
}
