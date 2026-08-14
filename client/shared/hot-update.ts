export const HOT_UPDATE_SCHEMA_VERSION = 1 as const;
export const HOT_UPDATE_PROTOCOL_VERSION = "1.0";
export const HOT_UPDATE_CAPABILITY = "hot-update.ui.v1";
export const UI_BUILD_IDENTITY_FILE = "ui-build.json";

export interface UiBuildIdentity {
  version: string;
  protocolVersion: string;
  buildEnv: string;
  capabilities: string[];
}

export interface UiUpdateArtifact {
  name: string;
  version: string;
  url: string;
  sha512: string;
  size: number;
  entry: string;
  minClientVersion: string;
  protocolVersion: string;
  releaseNotes?: string;
}

export interface UiUpdateManifest {
  schemaVersion: typeof HOT_UPDATE_SCHEMA_VERSION;
  channel: UpdateChannel;
  buildEnv: string;
  keyId: string;
  publishedAt: string;
  packages: UiUpdateArtifact[];
}

export interface InstalledUiPointer {
  activeVersion?: string;
  previousVersion?: string;
  pendingVersion?: string;
  bootingVersion?: string;
  lastGoodVersion?: string;
  failedVersions?: string[];
  updatedAt: string;
}

export interface InstalledUiPackageMetadata {
  schemaVersion: 1;
  name: string;
  version: string;
  entry: string;
  sha512: string;
  minClientVersion: string;
  protocolVersion: string;
  buildEnv: string;
  installedAt: string;
}

export type UpdateChannel = "stable" | "beta" | "nightly";

export interface UpdatePreferences {
  channel: UpdateChannel;
  autoCheck: boolean;
  autoDownload: boolean;
  autoApplyUi: boolean;
  ignoredVersion?: string;
}

export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
}

export interface UpdateState {
  status: "idle" | "checking" | "available" | "downloading" | "ready" | "error";
  updateKind?: "ui" | "client";
  applyMode?: "reload-ui" | "install-client";
  version?: string;
  releaseNotes?: string;
  progress?: UpdateProgress;
  error?: string;
  errorCode?:
    "network" | "checksum" | "permission" | "configuration" | "unknown";
  lastCheckedAt?: string;
}

export interface AppVersionInfo {
  clientVersion: string;
  uiVersion: string;
  buildEnv: string;
  protocolVersion: string;
  capabilities: string[];
  packaged: boolean;
  clientUpdateConfigured: boolean;
  hotUpdateConfigured: boolean;
  trustedKeyIds: string[];
}

export interface RendererReadyInfo {
  uiVersion: string;
  protocolVersion: string;
  capabilities: string[];
}

export interface RendererReadyReceipt {
  accepted: boolean;
  reason?:
    | "invalid_payload"
    | "version_mismatch"
    | "protocol_mismatch"
    | "capability_mismatch";
}
