import { createHash, verify } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import semver from "semver";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const channel = option("channel", "stable");
if (!["stable", "beta", "nightly"].includes(channel)) {
  throw new Error(`Unsupported update channel: ${channel}`);
}
const feedRoot = resolve(clientRoot, option("feed", `release/hot/${channel}`));
const publicKeysPath = resolve(
  clientRoot,
  option("public-keys", "resources/hot-update-public-keys.json"),
);
const manifestPath = join(feedRoot, "manifest.json");
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf-8"));
const publicKeys = JSON.parse(readFileSync(publicKeysPath, "utf-8"));
const publicKey = publicKeys[manifest.keyId];
if (!publicKey) throw new Error(`Untrusted manifest key id: ${manifest.keyId}`);
const signature = Buffer.from(
  readFileSync(join(feedRoot, "manifest.sig"), "utf-8").trim(),
  "base64",
);
const signatureValid = verify(null, manifestBytes, publicKey, signature);

const packages = manifest.packages.map((artifact) => {
  const packagePath = resolve(feedRoot, artifact.url);
  if (!packagePath.startsWith(`${resolve(feedRoot)}${sep}`)) {
    throw new Error(`Package escapes feed root: ${artifact.url}`);
  }
  const archive = readFileSync(packagePath);
  const entries = unzipSync(archive, {
    filter: (entry) => entry.name === "ui-build.json",
  });
  const identityBytes = entries["ui-build.json"];
  if (!identityBytes)
    throw new Error(`ui-build.json is missing from ${artifact.url}`);
  const identity = JSON.parse(Buffer.from(identityBytes).toString("utf-8"));
  return {
    name: artifact.name,
    version: artifact.version,
    sizeValid: statSync(packagePath).size === artifact.size,
    hashValid:
      createHash("sha512").update(archive).digest("base64") === artifact.sha512,
    identityValid:
      identity.version === artifact.version &&
      identity.protocolVersion === artifact.protocolVersion &&
      identity.buildEnv === manifest.buildEnv &&
      identity.capabilities?.includes("hot-update.ui.v1"),
    semverValid:
      Boolean(semver.valid(artifact.version)) &&
      Boolean(semver.valid(artifact.minClientVersion)),
  };
});
const valid =
  signatureValid &&
  manifest.schemaVersion === 1 &&
  manifest.channel === channel &&
  packages.length === 1 &&
  packages.every(
    (item) =>
      item.sizeValid &&
      item.hashValid &&
      item.identityValid &&
      item.semverValid,
  );
console.log(
  JSON.stringify(
    { channel, keyId: manifest.keyId, signatureValid, packages, valid },
    null,
    2,
  ),
);
if (!valid) process.exitCode = 1;
