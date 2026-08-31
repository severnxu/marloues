import {
  Brain,
  FileText,
  Globe,
  ListTree,
  ShieldCheck,
  SquareTerminal,
} from "lucide-react";
import type { AuxiliaryStaticViewType, AuxiliaryViewOption } from "./types";

export const AUXILIARY_VIEW_OPTIONS: readonly AuxiliaryViewOption[] = [
  { type: "outputs", label: "产出", icon: FileText },
  { type: "files", label: "文件", icon: ListTree },
  { type: "memory", label: "记忆", icon: Brain },
  { type: "review", label: "审核", icon: ShieldCheck },
  { type: "terminal", label: "终端", icon: SquareTerminal },
  { type: "browser", label: "浏览器", icon: Globe },
];

export const AUXILIARY_VIEW_LABELS = Object.fromEntries(
  AUXILIARY_VIEW_OPTIONS.map((option) => [option.type, option.label]),
) as Record<AuxiliaryStaticViewType, string>;

export const AUXILIARY_VIEW_ICONS = Object.fromEntries(
  AUXILIARY_VIEW_OPTIONS.map((option) => [option.type, option.icon]),
) as Record<AuxiliaryStaticViewType, AuxiliaryViewOption["icon"]>;
