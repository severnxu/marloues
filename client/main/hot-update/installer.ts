import { Unzip, UnzipInflate } from "fflate";
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  HOT_UPDATE_CAPABILITY,
  UI_BUILD_IDENTITY_FILE,
  type InstalledUiPackageMetadata,
  type UiBuildIdentity,
  type UiUpdateArtifact,
} from "@shared/hot-update";
import { MARLOUES_UPDATE_CONFIG } from "@shared/update-config";
import { sha512File } from "./download";
import {
  getUiPackageVersionDir,
  queueUiPackageActivation,
  readInstalledUiPackageMetadata,
  UI_PACKAGE_METADATA_FILE,
} from "./package-store";
import { safeOutputPath } from "./archive-policy";

const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 250 * 1024 * 1024;

export function extractArchiveSafely(
  zipPath: string,
  destination: string,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    let inputEnded = false;
    let activeEntries = 0;
    let entryCount = 0;
    let totalBytes = 0;
    let settled = false;
    const openDescriptors = new Set<number>();
    const input = createReadStream(zipPath);

    const closeDescriptor = (descriptor: number | undefined) => {
      if (descriptor === undefined || !openDescriptors.has(descriptor)) return;
      try {
        closeSync(descriptor);
      } finally {
        openDescriptors.delete(descriptor);
      }
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      for (const descriptor of [...openDescriptors]) {
        try {
          closeDescriptor(descriptor);
        } catch {
          // Preserve the original extraction error.
        }
      }
      input.destroy();
      rejectPromise(error instanceof Error ? error : new Error(String(error)));
    };
    const finishIfDone = () => {
      if (!settled && inputEnded && activeEntries === 0) {
        settled = true;
        resolvePromise();
      }
    };

    const unzip = new Unzip((entry) => {
      if (settled) return;
      entryCount += 1;
      activeEntries += 1;
      if (entryCount > MAX_ARCHIVE_ENTRIES) {
        fail(new Error("Update archive contains too many entries"));
        return;
      }
      let descriptor: number | undefined;
      let entryBytes = 0;
      try {
        const output = safeOutputPath(destination, entry.name);
        if (entry.name.endsWith("/")) {
          mkdirSync(output, { recursive: true });
        } else {
          mkdirSync(dirname(output), { recursive: true });
          descriptor = openSync(output, "w");
          openDescriptors.add(descriptor);
        }
      } catch (error) {
        fail(error);
        return;
      }

      entry.ondata = (error, chunk, final) => {
        if (settled) return;
        if (error) {
          closeDescriptor(descriptor);
          fail(error);
          return;
        }
        try {
          entryBytes += chunk.length;
          totalBytes += chunk.length;
          if (entryBytes > MAX_ENTRY_BYTES || totalBytes > MAX_UNPACKED_BYTES) {
            throw new Error("Update archive exceeds the extraction limit");
          }
          if (descriptor !== undefined && chunk.length) {
            writeSync(descriptor, chunk);
          }
          if (final) {
            closeDescriptor(descriptor);
            activeEntries -= 1;
            finishIfDone();
          }
        } catch (writeError) {
          closeDescriptor(descriptor);
          fail(writeError);
        }
      };
      entry.start();
    });
    unzip.register(UnzipInflate);

    input.on("data", (chunk) => {
      if (settled) return;
      try {
        unzip.push(new Uint8Array(Buffer.from(chunk)), false);
      } catch (error) {
        fail(error);
      }
    });
    input.on("error", fail);
    input.on("end", () => {
      try {
        unzip.push(new Uint8Array(), true);
        inputEnded = true;
        finishIfDone();
      } catch (error) {
        fail(error);
      }
    });
  });
}

function validateBuildIdentity(
  root: string,
  artifact: UiUpdateArtifact,
  buildEnv: string,
): void {
  let identity: UiBuildIdentity;
  try {
    identity = JSON.parse(
      readFileSync(safeOutputPath(root, UI_BUILD_IDENTITY_FILE), "utf-8"),
    ) as UiBuildIdentity;
  } catch {
    throw new Error(`UI build identity not found: ${UI_BUILD_IDENTITY_FILE}`);
  }
  if (
    identity.version !== artifact.version ||
    identity.protocolVersion !== artifact.protocolVersion ||
    identity.buildEnv !== buildEnv ||
    !Array.isArray(identity.capabilities) ||
    !identity.capabilities.includes(HOT_UPDATE_CAPABILITY)
  ) {
    throw new Error(
      `UI build identity does not match ${artifact.name}@${artifact.version}`,
    );
  }
}

export async function installUiPackage(
  artifact: UiUpdateArtifact,
  archivePath: string,
  buildEnv = MARLOUES_UPDATE_CONFIG.buildEnv,
): Promise<string> {
  const actualHash = await sha512File(archivePath);
  if (actualHash !== artifact.sha512) {
    truncateSync(archivePath, 0);
    throw new Error(
      `Checksum mismatch for ${artifact.name}@${artifact.version}`,
    );
  }

  const destination = getUiPackageVersionDir(artifact.name, artifact.version);
  const metadata: InstalledUiPackageMetadata = {
    schemaVersion: 1,
    name: artifact.name,
    version: artifact.version,
    entry: artifact.entry,
    sha512: artifact.sha512,
    minClientVersion: artifact.minClientVersion,
    protocolVersion: artifact.protocolVersion,
    buildEnv,
    installedAt: new Date().toISOString(),
  };
  if (!existsSync(destination)) {
    const staging = `${destination}.staging-${process.pid}-${Date.now()}`;
    mkdirSync(staging, { recursive: true });
    await extractArchiveSafely(archivePath, staging);
    const entryPath = safeOutputPath(staging, artifact.entry);
    if (!existsSync(entryPath)) {
      throw new Error(
        `Package entry not found after extraction: ${artifact.entry}`,
      );
    }
    validateBuildIdentity(staging, artifact, buildEnv);
    writeFileSync(
      join(staging, UI_PACKAGE_METADATA_FILE),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf-8",
    );
    renameSync(staging, destination);
  } else {
    validateBuildIdentity(destination, artifact, buildEnv);
    const installed = readInstalledUiPackageMetadata(
      artifact.name,
      artifact.version,
    );
    const identityMatches =
      installed?.schemaVersion === metadata.schemaVersion &&
      installed.name === metadata.name &&
      installed.version === metadata.version &&
      installed.entry === metadata.entry &&
      installed.sha512 === metadata.sha512 &&
      installed.minClientVersion === metadata.minClientVersion &&
      installed.protocolVersion === metadata.protocolVersion &&
      installed.buildEnv === metadata.buildEnv;
    if (!identityMatches) {
      throw new Error(
        `UI package version collision for ${artifact.name}@${artifact.version}; publish a new UI version`,
      );
    }
  }

  const installedEntry = safeOutputPath(destination, artifact.entry);
  if (!existsSync(installedEntry)) {
    throw new Error(`Installed package entry not found: ${artifact.entry}`);
  }
  queueUiPackageActivation(artifact.name, artifact.version);
  return installedEntry;
}
