/** Full-screen settings surface state. */

import { create } from "zustand";
import type { SettingsSection } from "@/components/settings";

interface SettingsDialogState {
  open: boolean;
  section: SettingsSection | null;
  /** 打开设置页，可指定初始 section。 */
  openSection: (section?: SettingsSection) => void;
  /** 切换设置页状态，首次打开使用默认 section。 */
  toggle: (section?: SettingsSection) => void;
  /** 关闭 dialog。 */
  close: () => void;
}

const DEFAULT_SECTION: SettingsSection = "general";

export const useSettingsDialogStore = create<SettingsDialogState>(
  (set, get) => ({
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
  }),
);

export const settingsDialogActions = {
  open: (section?: SettingsSection) =>
    useSettingsDialogStore.getState().openSection(section),
  toggle: (section?: SettingsSection) =>
    useSettingsDialogStore.getState().toggle(section),
  close: () => useSettingsDialogStore.getState().close(),
};
