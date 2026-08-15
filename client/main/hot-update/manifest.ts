import { verify } from "node:crypto";
import semver from "semver";
import {
  HOT_UPDATE_PROTOCOL_VERSION,
  HOT_UPDATE_SCHEMA_VERSION,
  type InstalledUiPackageMetadata,
  type UiBuildIdentity,
  type UiUpdateArtifact,
  type UiUpdateManifest,
  type UpdateChannel,
} from "@shared/hot-update";

const MAX_ARTIFACT_SIZE = 250 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid hot-update manifest field: ${key}`);
  }
  return value;
}

function parseVersion(value: string, field: string): string {
  const version = semver.valid(value);
  if (!version)
    throw new Error(`Invalid semantic version in ${field}: ${value}`);
  return version;
}

function parseArtifact(value: unknown): UiUpdateArtifact {
  if (!isRecord(value)) throw new Error("Invalid hot-update artifact");
  const size = value.size;
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MAX_ARTIFACT_SIZE
  ) {
    throw new Error("Invalid hot-update artifact size");
  }
  return {
    name: requiredString(value, "name"),
    version: parseVersion(requiredString(value, "version"), "version"),
    url: requiredString(value, "url"),
    sha512: requiredString(value, "sha512"),
    size,
    entry: requiredString(value, "entry"),
    minClientVersion: parseVersion(
      requiredString(value, "minClientVersion"),
      "minClientVersion",
    ),
    protocolVersion: requiredString(value, "protocolVersion"),
    releaseNotes:
      typeof value.releaseNotes === "string" ? value.releaseNotes : undefined,
  };
}

function parseUntrustedManifest(bytes: Buffer): Record<string, unknown> {
  const parsed: unknown = JSON.parse(bytes.toString("utf-8"));
  if (!isRecord(parsed)) throw new Error("Invalid hot-update manifest");
  return parsed;
}

export function parseAndVerifyManifest(input: {
  manifestBytes: Buffer;
  signatureBase64: string;
  publicKeys: Record<string, string>;
  expectedBuildEnv: string;
  expectedChannel: UpdateChannel;
}): UiUpdateManifest {
  const parsed = parseUntrustedManifest(input.manifestBytes);
  const keyId = requiredString(parsed, "keyId");
  const publicKey = input.publicKeys[keyId];
  if (!publicKey?.trim()) {
    throw new Error(
      `Hot-update manifest uses an untrusted signing key: ${keyId}`,
    );
  }
  const signature = Buffer.from(input.signatureBase64.trim(), "base64");
  if (!signature.length) throw new Error("Hot-update signature is empty");
  if (!verify(null, input.manifestBytes, publicKey, signature)) {
    throw new Error("Hot-update manifest signature verification failed");
  }

  if (parsed.schemaVersion !== HOT_UPDATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported hot-update schema: ${parsed.schemaVersion}`);
  }
  const buildEnv = requiredString(parsed, "buildEnv");
  if (buildEnv !== input.expectedBuildEnv) {
    throw new Error(
      `Hot-update environment mismatch: expected ${input.expectedBuildEnv}, received ${buildEnv}`,
    );
  }
  const channel = requiredString(parsed, "channel");
  if (channel !== input.expectedChannel) {
    throw new Error(
      `Hot-update channel mismatch: expected ${input.expectedChannel}, received ${channel}`,
    );
  }
  if (!Array.isArray(parsed.packages) || parsed.packages.length === 0) {
    throw new Error("Invalid hot-update packages list");
  }
  return {
    schemaVersion: HOT_UPDATE_SCHEMA_VERSION,
    channel: input.expectedChannel,
    buildEnv,
    keyId,
    publishedAt: requiredString(parsed, "publishedAt"),
    packages: parsed.packages.map(parseArtifact),
  };
}

export function compareVersions(left: string, right: string): number {
  const leftVersion = semver.valid(left);
  const rightVersion = semver.valid(right);
  if (!leftVersion || !rightVersion) return 0;
  return semver.compare(leftVersion, rightVersion);
}

export function isUiArtifactCompatible(
  artifact: UiUpdateArtifact,
  clientVersion: string,
): boolean {
  return (
    semver.valid(clientVersion) !== null &&
    semver.gte(clientVersion, artifact.minClientVersion) &&
    artifact.protocolVersion === HOT_UPDATE_PROTOCOL_VERSION
  );
}

export function isInstalledUiPackageCompatible(input: {
  name: string;
  version: string;
  bundledVersion: string;
  clientVersion: string;
  buildEnv: string;
  metadata: InstalledUiPackageMetadata | null;
  identity: UiBuildIdentity | null;
  requiredCapabilities: string[];
}): boolean {
  const { metadata, identity } = input;
  return Boolean(
    metadata &&
    identity &&
    metadata.schemaVersion === 1 &&
    metadata.name === input.name &&
    metadata.version === input.version &&
    metadata.protocolVersion === HOT_UPDATE_PROTOCOL_VERSION &&
    metadata.buildEnv === input.buildEnv &&
    semver.valid(input.clientVersion) &&
    semver.gte(input.clientVersion, metadata.minClientVersion) &&
    compareVersions(input.version, input.bundledVersion) > 0 &&
    identity.version === input.version &&
    identity.protocolVersion === HOT_UPDATE_PROTOCOL_VERSION &&
    identity.buildEnv === input.buildEnv &&
    Array.isArray(identity.capabilities) &&
    input.requiredCapabilities.every((capability) =>
      identity.capabilities.includes(capability),
    ),
  );
}

export function resolveArtifactUrl(
  manifestUrl: string,
  artifactUrl: string,
): string {
  const manifest = new URL(manifestUrl);
  const resolved = new URL(artifactUrl, manifest);
  if (resolved.protocol !== "https:") {
    throw new Error("Hot-update artifacts must use HTTPS");
  }
  if (resolved.origin !== manifest.origin) {
    throw new Error("Hot-update artifact origin does not match its manifest");
  }
  return resolved.toString();
}
