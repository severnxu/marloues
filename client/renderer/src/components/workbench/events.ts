export const OPEN_AUXILIARY_PANEL_EVENT = "marloues:open-auxiliary-panel";

export type AuxiliaryPanelTab = "files" | "changes" | "plan";

export function openAuxiliaryPanel(tab: AuxiliaryPanelTab): void {
  window.dispatchEvent(
    new CustomEvent(OPEN_AUXILIARY_PANEL_EVENT, { detail: { tab } }),
  );
}
