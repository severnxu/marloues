import type { InstalledUiPointer } from "@shared/hot-update";

function recoveryVersion(
  pointer: InstalledUiPointer,
  failed: Set<string>,
  excludedVersion: string,
): string | undefined {
  return [pointer.previousVersion, pointer.lastGoodVersion].find(
    (candidate) =>
      candidate && candidate !== excludedVersion && !failed.has(candidate),
  );
}

export function recoverInterruptedBoot(
  pointer: InstalledUiPointer,
): InstalledUiPointer {
  if (!pointer.bootingVersion) return pointer;
  const failed = new Set(pointer.failedVersions ?? []);
  failed.add(pointer.bootingVersion);
  return {
    ...pointer,
    activeVersion: recoveryVersion(pointer, failed, pointer.bootingVersion),
    previousVersion: undefined,
    pendingVersion: undefined,
    bootingVersion: undefined,
    failedVersions: [...failed],
  };
}

export function activatePendingVersion(
  pointer: InstalledUiPointer,
): InstalledUiPointer {
  if (!pointer.pendingVersion) return pointer;
  const failed = new Set(pointer.failedVersions ?? []);
  if (failed.has(pointer.pendingVersion)) {
    return { ...pointer, pendingVersion: undefined };
  }
  return {
    ...pointer,
    previousVersion: pointer.activeVersion ?? pointer.lastGoodVersion,
    activeVersion: pointer.pendingVersion,
    bootingVersion: pointer.pendingVersion,
    pendingVersion: undefined,
  };
}

export function confirmReadyVersion(
  pointer: InstalledUiPointer,
  version: string,
): InstalledUiPointer {
  if (pointer.bootingVersion !== version) return pointer;
  return {
    ...pointer,
    lastGoodVersion: version,
    bootingVersion: undefined,
  };
}

export function failPackageVersion(
  pointer: InstalledUiPointer,
  version: string,
): InstalledUiPointer {
  const failed = new Set(pointer.failedVersions ?? []);
  failed.add(version);
  return {
    ...pointer,
    activeVersion: recoveryVersion(pointer, failed, version),
    previousVersion: undefined,
    pendingVersion: undefined,
    bootingVersion: undefined,
    failedVersions: [...failed],
  };
}
