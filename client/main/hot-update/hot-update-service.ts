import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { MARLOUES_UPDATE_CONFIG } from "@shared/update-config";
import type {
  UiUpdateArtifact,
  UiUpdateManifest,
  UpdateChannel,
  UpdateState,
} from "@shared/hot-update";
import { downloadToFile, fetchBytes } from "./download";
import { installUiPackage } from "./installer";
import {
  compareVersions,
  isUiArtifactCompatible,
  parseAndVerifyManifest,
  resolveArtifactUrl,
} from "./manifest";
import {
  getAppVersionInfo,
  getUiUpdatesRoot,
  isUiPackageVersionFailed,
} from "./package-store";
import { activatePendingRenderer } from "./renderer-controller";

export interface UiUpdateCandidate {
  manifest: UiUpdateManifest;
  manifestUrl: string;
  artifact: UiUpdateArtifact;
}

let currentCandidate: UiUpdateCandidate | null = null;
let installedCandidate: UiUpdateCandidate | null = null;

function uiManifestUrl(channel: UpdateChannel): string {
  const configured = MARLOUES_UPDATE_CONFIG.hotUpdateUrl;
  if (!configured) throw new Error("UI hot-update feed is not configured");
  const base = configured.endsWith("/") ? configured : `${configured}/`;
  const url = new URL(`${encodeURIComponent(channel)}/manifest.json`, base);
  if (url.protocol !== "https:") {
    throw new Error("UI hot-update feed must use HTTPS");
  }
  return url.toString();
}

function newestArtifact(manifest: UiUpdateManifest): UiUpdateArtifact | null {
  const currentVersion = getAppVersionInfo().uiVersion;
  return (
    manifest.packages
      .filter((artifact) => artifact.name === "default")
      .filter((artifact) => isUiArtifactCompatible(artifact, app.getVersion()))
      .filter(
        (artifact) =>
          !isUiPackageVersionFailed(artifact.name, artifact.version),
      )
      .filter(
        (artifact) => compareVersions(artifact.version, currentVersion) > 0,
      )
      .sort((left, right) => compareVersions(right.version, left.version))[0] ??
    null
  );
}

export async function checkForHotUpdates(
  channel: UpdateChannel,
): Promise<UiUpdateCandidate | null> {
  currentCandidate = null;
  installedCandidate = null;
  if (
    !MARLOUES_UPDATE_CONFIG.hotUpdateUrl ||
    Object.keys(MARLOUES_UPDATE_CONFIG.hotUpdatePublicKeys).length === 0
  ) {
    return null;
  }

  const manifestUrl = uiManifestUrl(channel);
  const [manifestBytes, signatureBytes] = await Promise.all([
    fetchBytes(manifestUrl),
    fetchBytes(new URL("manifest.sig", manifestUrl).toString()),
  ]);
  const manifest = parseAndVerifyManifest({
    manifestBytes,
    signatureBase64: signatureBytes.toString("utf-8"),
    publicKeys: MARLOUES_UPDATE_CONFIG.hotUpdatePublicKeys,
    expectedBuildEnv: MARLOUES_UPDATE_CONFIG.buildEnv,
    expectedChannel: channel,
  });
  const artifact = newestArtifact(manifest);
  if (!artifact) return null;
  currentCandidate = { manifest, manifestUrl, artifact };
  return currentCandidate;
}

export function hotCandidateState(
  candidate: UiUpdateCandidate,
  status: UpdateState["status"] = "available",
): UpdateState {
  return {
    status,
    updateKind: "ui",
    applyMode: "reload-ui",
    version: candidate.artifact.version,
    releaseNotes: candidate.artifact.releaseNotes,
  };
}

export async function downloadAndInstallHotUpdate(input: {
  onProgress?: (transferred: number, total: number) => void;
}): Promise<UiUpdateCandidate> {
  const candidate = currentCandidate;
  if (!candidate) throw new Error("No UI update is available");
  const { artifact } = candidate;
  const archivePath = join(
    getUiUpdatesRoot(),
    ".downloads",
    `${artifact.name}-${artifact.version}.zip.download`,
  );
  await downloadToFile({
    url: resolveArtifactUrl(candidate.manifestUrl, artifact.url),
    destination: archivePath,
    expectedSize: artifact.size,
    onProgress: input.onProgress,
  });
  await installUiPackage(artifact, archivePath, candidate.manifest.buildEnv);
  installedCandidate = candidate;
  return candidate;
}

export async function applyInstalledHotUpdate(): Promise<void> {
  if (!installedCandidate) throw new Error("No downloaded UI update is ready");
  const window = BrowserWindow.getAllWindows().find(
    (item) => !item.isDestroyed(),
  );
  if (!window) throw new Error("The application window is unavailable");
  await activatePendingRenderer(window);
}
