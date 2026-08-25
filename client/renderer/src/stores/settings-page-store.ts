/** Full-screen settings surface state. */

import { create } from "zustand";
import type { SettingsSection } from "@/components/settings";

interface SettingsPageState {
  open: boolean;
  section: SettingsSection | null;
  /** 打开设置页，可指定初始 section。 */
  openSection: (section?: SettingsSection) => void;
  /** 切换设置页状态，首次打开使用默认 section。 */
  toggle: (section?: SettingsSection) => void;
  /** 关闭设置页。 */
  close: () => void;
}

const DEFAULT_SECTION: SettingsSection = "general";

export const useSettingsPageStore = create<SettingsPageState>((set, get) => ({
  open: false,
  section: null,

  openSection: (section) =>
    set({
      open: true,
      section: section ?? DEFAULT_SECTION,
    }),

  toggle: (section) => {
    const { open } = get();
    if (open) {
      set({ open: false });
    } else {
      set({ open: true, section: section ?? DEFAULT_SECTION });
    }
  },

  close: () => set({ open: false, section: null }),
}));
