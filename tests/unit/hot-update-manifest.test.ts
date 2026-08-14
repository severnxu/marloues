import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isInstalledUiPackageCompatible,
  isUiArtifactCompatible,
  parseAndVerifyManifest,
  resolveArtifactUrl,
} from "../../client/main/hot-update/manifest";
import {
  HOT_UPDATE_CAPABILITY,
  HOT_UPDATE_PROTOCOL_VERSION,
} from "../../client/shared/hot-update";

function signedManifest(overrides: Record<string, unknown> = {}) {
  const pair = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const manifest = {
    schemaVersion: 1,
    channel: "stable",
    buildEnv: "production",
    keyId: "official-2026-01",
    publishedAt: "2026-08-14T00:00:00.000Z",
    packages: [
      {
        name: "default",
        version: "1.2.0",
        url: "packages/marloues-ui-1.2.0.zip",
        sha512: "hash",
        size: 1024,
        entry: "index.html",
        minClientVersion: "1.0.0",
        protocolVersion: HOT_UPDATE_PROTOCOL_VERSION,
      },
    ],
    ...overrides,
  };
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  return {
    bytes,
    publicKey: pair.publicKey,
    signature: sign(null, bytes, pair.privateKey).toString("base64"),
  };
}

describe("signed hot-update manifests", () => {
  it("accepts a manifest signed by its trusted key id", () => {
    const fixture = signedManifest();
    const manifest = parseAndVerifyManifest({
      manifestBytes: fixture.bytes,
      signatureBase64: fixture.signature,
      publicKeys: { "official-2026-01": fixture.publicKey },
      expectedBuildEnv: "production",
      expectedChannel: "stable",
    });
    expect(manifest.keyId).toBe("official-2026-01");
    expect(manifest.packages[0]?.version).toBe("1.2.0");
  });

  it("fails closed for tampering, unknown keys, environments, and channels", () => {
    const fixture = signedManifest();
    expect(() =>
      parseAndVerifyManifest({
        manifestBytes: Buffer.concat([fixture.bytes, Buffer.from(" ")]),
        signatureBase64: fixture.signature,
        publicKeys: { "official-2026-01": fixture.publicKey },
        expectedBuildEnv: "production",
        expectedChannel: "stable",
      }),
    ).toThrow(/signature verification failed/i);
    expect(() =>
      parseAndVerifyManifest({
        manifestBytes: fixture.bytes,
        signatureBase64: fixture.signature,
        publicKeys: {},
        expectedBuildEnv: "production",
        expectedChannel: "stable",
      }),
    ).toThrow(/untrusted signing key/i);
    expect(() =>
      parseAndVerifyManifest({
        manifestBytes: fixture.bytes,
        signatureBase64: fixture.signature,
        publicKeys: { "official-2026-01": fixture.publicKey },
        expectedBuildEnv: "development",
        expectedChannel: "stable",
      }),
    ).toThrow(/environment mismatch/i);
    expect(() =>
      parseAndVerifyManifest({
        manifestBytes: fixture.bytes,
        signatureBase64: fixture.signature,
        publicKeys: { "official-2026-01": fixture.publicKey },
        expectedBuildEnv: "production",
        expectedChannel: "beta",
      }),
    ).toThrow(/channel mismatch/i);
  });
});

describe("hot-update compatibility", () => {
  const artifact = {
    name: "default",
    version: "1.2.0",
    url: "packages/ui.zip",
    sha512: "hash",
    size: 10,
    entry: "index.html",
    minClientVersion: "1.0.0",
    protocolVersion: HOT_UPDATE_PROTOCOL_VERSION,
  };

  it("uses SemVer precedence, including prereleases", () => {
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.2", "1.0.0")).toBeLessThan(0);
    expect(isUiArtifactCompatible(artifact, "1.0.0")).toBe(true);
    expect(isUiArtifactCompatible(artifact, "0.9.9")).toBe(false);
  });

  it("requires matching installed metadata and compiled UI identity", () => {
    expect(
      isInstalledUiPackageCompatible({
        name: "default",
        version: "1.2.0",
        bundledVersion: "1.1.0",
        clientVersion: "1.0.0",
        buildEnv: "production",
        metadata: {
          schemaVersion: 1,
          name: "default",
          version: "1.2.0",
          entry: "index.html",
          sha512: "hash",
          minClientVersion: "1.0.0",
          protocolVersion: HOT_UPDATE_PROTOCOL_VERSION,
          buildEnv: "production",
          installedAt: "2026-08-14T00:00:00.000Z",
        },
        identity: {
          version: "1.2.0",
          protocolVersion: HOT_UPDATE_PROTOCOL_VERSION,
          buildEnv: "production",
          capabilities: [HOT_UPDATE_CAPABILITY],
        },
        requiredCapabilities: [HOT_UPDATE_CAPABILITY],
      }),
    ).toBe(true);
  });

  it("allows only same-origin HTTPS artifacts", () => {
    expect(
      resolveArtifactUrl(
        "https://updates.example.com/stable/manifest.json",
        "packages/ui.zip",
      ),
    ).toBe("https://updates.example.com/stable/packages/ui.zip");
    expect(() =>
      resolveArtifactUrl(
        "https://updates.example.com/stable/manifest.json",
        "https://evil.example/ui.zip",
      ),
    ).toThrow(/origin/i);
    expect(() =>
      resolveArtifactUrl(
        "http://updates.example.com/stable/manifest.json",
        "packages/ui.zip",
      ),
    ).toThrow(/https/i);
  });
});
