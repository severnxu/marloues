import { app } from "electron";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { getMarlouesHome } from "../app-paths";
import { UI_BUILD_VERSION } from "@shared/build-info";
import {
  HOT_UPDATE_CAPABILITY,
  HOT_UPDATE_PROTOCOL_VERSION,
  UI_BUILD_IDENTITY_FILE,
  type AppVersionInfo,
  type InstalledUiPackageMetadata,
  type InstalledUiPointer,
  type UiBuildIdentity,
} from "@shared/hot-update";
import { MARLOUES_UPDATE_CONFIG } from "@shared/update-config";
import { isInstalledUiPackageCompatible } from "./manifest";
import {
  activatePendingVersion,
  confirmReadyVersion,
  failPackageVersion,
  recoverInterruptedBoot,
} from "./pointer-state";

const UI_PACKAGE_NAME = "default";
const CAPABILITIES = [HOT_UPDATE_CAPABILITY];
export const UI_PACKAGE_METADATA_FILE = ".marloues-ui-package.json";
let selectedVersion = UI_BUILD_VERSION;

function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`Unsafe package path segment: ${value}`);
  }
  return value;
}

export function getUiUpdatesRoot(): string {
  return join(getMarlouesHome(), "ui-updates");
}

export function getUiPackageFamilyDir(name = UI_PACKAGE_NAME): string {
  return join(getUiUpdatesRoot(), safeSegment(name));
}

export function getUiPackageVersionDir(name: string, version: string): string {
  return join(getUiPackageFamilyDir(name), safeSegment(version));
}

function pointerPath(name: string): string {
  return join(getUiPackageFamilyDir(name), "active.json");
}

function emptyPointer(): InstalledUiPointer {
  return { updatedAt: new Date(0).toISOString() };
}

export function readUiPackagePointer(
  name = UI_PACKAGE_NAME,
): InstalledUiPointer {
  const filePath = pointerPath(name);
  if (!existsSync(filePath)) return emptyPointer();
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as InstalledUiPointer)
      : emptyPointer();
  } catch {
    return emptyPointer();
  }
}

function writePointer(name: string, pointer: InstalledUiPointer): void {
  const filePath = pointerPath(name);
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(
    tempPath,
    `${JSON.stringify({ ...pointer, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf-8",
  );
  try {
    renameSync(tempPath, filePath);
  } catch {
    copyFileSync(tempPath, filePath);
    unlinkSync(tempPath);
  }
}

function isInsidePackageDir(path: string, familyDir: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedFamily = resolve(familyDir);
  return (
    resolvedPath === resolvedFamily ||
    resolvedPath.startsWith(`${resolvedFamily}${sep}`)
  );
}

export function readInstalledUiPackageMetadata(
  name: string,
  version: string,
): InstalledUiPackageMetadata | null {
  const filePath = join(
    getUiPackageVersionDir(name, version),
    UI_PACKAGE_METADATA_FILE,
  );
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(
      readFileSync(filePath, "utf-8"),
    ) as InstalledUiPackageMetadata;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function validatedInstalledEntry(input: {
  name: string;
  version: string;
  bundledVersion: string;
  familyDir: string;
}): string | null {
  const metadata = readInstalledUiPackageMetadata(input.name, input.version);
  if (!metadata) return null;
  let identity: UiBuildIdentity | null;
  try {
    identity = JSON.parse(
      readFileSync(
        join(
          getUiPackageVersionDir(input.name, input.version),
          UI_BUILD_IDENTITY_FILE,
        ),
        "utf-8",
      ),
    ) as UiBuildIdentity;
  } catch {
    identity = null;
  }
  if (
    !isInstalledUiPackageCompatible({
      name: input.name,
      version: input.version,
      bundledVersion: input.bundledVersion,
      clientVersion: app.getVersion(),
      buildEnv: MARLOUES_UPDATE_CONFIG.buildEnv,
      metadata,
      identity,
      requiredCapabilities: CAPABILITIES,
    })
  ) {
    return null;
  }
  const entryPath = join(
    getUiPackageVersionDir(input.name, input.version),
    metadata.entry,
  );
  return isInsidePackageDir(entryPath, input.familyDir) && existsSync(entryPath)
    ? entryPath
    : null;
}

export interface SelectedUiPackage {
  version: string;
  entryPath: string;
  bundled: boolean;
}

export function selectUiPackageForBoot(input: {
  bundledVersion: string;
  bundledEntry: string;
  name?: string;
}): SelectedUiPackage {
  const name = input.name ?? UI_PACKAGE_NAME;
  const familyDir = getUiPackageFamilyDir(name);

  if (process.argv.includes("--disable-hot-update")) {
    selectedVersion = input.bundledVersion;
    return {
      version: input.bundledVersion,
      entryPath: input.bundledEntry,
      bundled: true,
    };
  }

  const pointer = readUiPackagePointer(name);
  if (pointer.bootingVersion) {
    writePointer(name, recoverInterruptedBoot(pointer));
  }
  const recovered = readUiPackagePointer(name);
  if (recovered.pendingVersion) {
    writePointer(name, activatePendingVersion(recovered));
  }

  let activePointer = readUiPackagePointer(name);
  let active = activePointer.activeVersion;
  for (let attempt = 0; attempt < 2 && active; attempt += 1) {
    if (!activePointer.failedVersions?.includes(active)) {
      const entryPath = validatedInstalledEntry({
        name,
        version: active,
        bundledVersion: input.bundledVersion,
        familyDir,
      });
      if (entryPath) {
        writePointer(name, { ...activePointer, bootingVersion: active });
        selectedVersion = active;
        return { version: active, entryPath, bundled: false };
      }
      writePointer(name, failPackageVersion(activePointer, active));
      activePointer = readUiPackagePointer(name);
      active = activePointer.activeVersion;
      continue;
    }
    break;
  }

  selectedVersion = input.bundledVersion;
  return {
    version: input.bundledVersion,
    entryPath: input.bundledEntry,
    bundled: true,
  };
}

export function queueUiPackageActivation(name: string, version: string): void {
  const pointer = readUiPackagePointer(name);
  writePointer(name, { ...pointer, pendingVersion: safeSegment(version) });
}

export function markUiPackageReady(
  version: string,
  name = UI_PACKAGE_NAME,
): void {
  selectedVersion = version;
  const pointer = readUiPackagePointer(name);
  if (pointer.bootingVersion === version) {
    writePointer(name, confirmReadyVersion(pointer, version));
  }
}

export function markUiPackageFailed(
  version: string,
  name = UI_PACKAGE_NAME,
): void {
  writePointer(name, failPackageVersion(readUiPackagePointer(name), version));
}

export function getSelectedUiVersion(): string {
  return selectedVersion;
}

export function isUiPackageReady(
  version: string,
  name = UI_PACKAGE_NAME,
): boolean {
  if (version === UI_BUILD_VERSION) return true;
  const pointer = readUiPackagePointer(name);
  return (
    pointer.bootingVersion !== version && pointer.lastGoodVersion === version
  );
}

export function isUiPackageVersionFailed(
  name: string,
  version: string,
): boolean {
  return Boolean(readUiPackagePointer(name).failedVersions?.includes(version));
}

export function getAppVersionInfo(): AppVersionInfo {
  const trustedKeyIds = Object.keys(MARLOUES_UPDATE_CONFIG.hotUpdatePublicKeys);
  return {
    clientVersion: app.getVersion(),
    uiVersion: selectedVersion,
    buildEnv: MARLOUES_UPDATE_CONFIG.buildEnv,
    protocolVersion: HOT_UPDATE_PROTOCOL_VERSION,
    capabilities: [...CAPABILITIES],
    packaged: app.isPackaged,
    clientUpdateConfigured:
      MARLOUES_UPDATE_CONFIG.clientProvider === "github" ||
      Boolean(MARLOUES_UPDATE_CONFIG.clientUpdateUrl),
    hotUpdateConfigured:
      Boolean(MARLOUES_UPDATE_CONFIG.hotUpdateUrl) && trustedKeyIds.length > 0,
    trustedKeyIds,
  };
}
