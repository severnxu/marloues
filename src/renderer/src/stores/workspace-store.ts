import { create } from "zustand";
import type { WorkspaceInfo, WorkspaceSettings } from "@shared/types";
import { ipc } from "@/lib/ipc-client";

interface WorkspaceStore {
  current: WorkspaceInfo | null;
  settings: WorkspaceSettings;
  load: () => Promise<void>;
  select: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<void>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  openInExplorer: (workspaceId: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  current: null,
  settings: { workspaces: [] },
  load: async () => {
    const settings = await ipc.workspace.getSettings();
    const current = settings.workspaces.find((workspace) => workspace.id === settings.currentWorkspaceId) ?? null;
    set({ current, settings });
  },
  select: async () => {
    const workspace = await ipc.workspace.select();
    if (!workspace) return;
    const settings = await ipc.workspace.getSettings();
    set({ current: workspace, settings });
  },
  switchWorkspace: async (workspaceId: string) => {
    const workspace = await ipc.workspace.switch(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    const settings = await ipc.workspace.getSettings();
    set({ current: workspace, settings });
  },
  renameWorkspace: async (workspaceId: string, name: string) => {
    const workspace = await ipc.workspace.rename(workspaceId, name);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    const settings = await ipc.workspace.getSettings();
    const current = settings.workspaces.find((item) => item.id === settings.currentWorkspaceId) ?? null;
    set({ current, settings });
  },
  removeWorkspace: async (workspaceId: string) => {
    const current = await ipc.workspace.remove(workspaceId);
    const settings = await ipc.workspace.getSettings();
    set({ current, settings });
  },
  openInExplorer: async (workspaceId: string) => {
    await ipc.workspace.openInExplorer(workspaceId);
  },
}));
