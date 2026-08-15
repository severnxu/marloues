import { createHash, sign } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import semver from "semver";

function argumentsMap(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const equals = value.indexOf("=");
    if (equals > 0) {
      result.set(value.slice(2, equals), value.slice(equals + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      result.set(value.slice(2), next);
      index += 1;
    } else {
      result.set(value.slice(2), "true");
    }
  }
  return result;
}

function safeSegment(value, label) {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}

function atomicWrite(filePath, bytes) {
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, bytes);
  try {
    renameSync(tempPath, filePath);
  } catch {
    copyFileSync(tempPath, filePath);
    unlinkSync(tempPath);
  }
}

function archiveFiles(root) {
  const files = {};
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        files[relative(root, path).replaceAll("\\", "/")] = readFileSync(path);
      }
    }
  };
  visit(root);
  return zipSync(files, { level: 9 });
}

const args = argumentsMap(process.argv.slice(2));
if (args.has("help")) {
  console.log(`Usage: npm run publish:hot -- --channel stable --key-id <id> [options]

Options:
  --channel <name>       stable, beta, or nightly (default: stable)
  --key-id <id>          Signing key id (required)
  --private-key <path>   Ed25519 private key path
  --version <version>    UI version (must match ui-version.json)
  --min-client <version> Minimum compatible client version
  --notes <text>         Release notes
  --output <path>        Feed output directory
  --ui-dir <path>        Renderer build directory
  --build-env <name>     Build environment from ui-build.json`);
  process.exit(0);
}

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  readFileSync(join(clientRoot, "package.json"), "utf-8"),
);
const uiVersionConfig = JSON.parse(
  readFileSync(join(clientRoot, "ui-version.json"), "utf-8"),
);
const channel = args.get("channel") ?? "stable";
if (!["stable", "beta", "nightly"].includes(channel)) {
  throw new Error(`Unsupported update channel: ${channel}`);
}
const keyId = safeSegment(args.get("key-id") ?? "", "key id");
const version = semver.valid(args.get("version") ?? uiVersionConfig.version);
if (!version || version !== uiVersionConfig.version) {
  throw new Error(
    `UI version must be valid SemVer and match ui-version.json (${uiVersionConfig.version})`,
  );
}
const minClientVersion = semver.valid(
  args.get("min-client") ?? packageJson.version,
);
if (!minClientVersion)
  throw new Error("Minimum client version must be valid SemVer");

const privateKeyPath = resolve(
  clientRoot,
  args.get("private-key") ??
    process.env.MARLOUES_HOT_UPDATE_PRIVATE_KEY ??
    `keys/hot-update-${keyId}-private.pem`,
);
if (!existsSync(privateKeyPath)) {
  throw new Error(`Hot-update private key not found: ${privateKeyPath}`);
}
const sourceDir = resolve(clientRoot, args.get("ui-dir") ?? "out/renderer");
const identityPath = join(sourceDir, "ui-build.json");
if (!existsSync(identityPath)) {
  throw new Error(`UI build identity not found: ${identityPath}`);
}
const identity = JSON.parse(readFileSync(identityPath, "utf-8"));
const buildEnv = safeSegment(
  args.get("build-env") ?? identity.buildEnv ?? "production",
  "build environment",
);
if (
  identity.version !== version ||
  identity.protocolVersion !== "1.0" ||
  identity.buildEnv !== buildEnv ||
  !Array.isArray(identity.capabilities) ||
  !identity.capabilities.includes("hot-update.ui.v1")
) {
  throw new Error(
    "Renderer build identity is incompatible with hot-update protocol 1.0",
  );
}

const feedRoot = resolve(
  clientRoot,
  args.get("output") ?? `release/hot/${channel}`,
);
const existingManifestPath = join(feedRoot, "manifest.json");
if (existsSync(existingManifestPath)) {
  const existing = JSON.parse(readFileSync(existingManifestPath, "utf-8"));
  const previousVersion = existing.packages?.find(
    (item) => item?.name === "default",
  )?.version;
  if (
    previousVersion &&
    semver.valid(previousVersion) &&
    !semver.gt(version, previousVersion)
  ) {
    throw new Error(
      `UI version must increase (existing ${previousVersion}, requested ${version})`,
    );
  }
}

const packagesDir = join(feedRoot, "packages");
mkdirSync(packagesDir, { recursive: true });
const archivePath = join(packagesDir, `marloues-ui-${version}.zip`);
writeFileSync(archivePath, archiveFiles(sourceDir));
const artifact = {
  name: "default",
  version,
  url: `packages/${basename(archivePath)}`,
  sha512: createHash("sha512")
    .update(readFileSync(archivePath))
    .digest("base64"),
  size: statSync(archivePath).size,
  entry: "index.html",
  minClientVersion,
  protocolVersion: "1.0",
  releaseNotes: args.get("notes") ?? `Marloues UI ${version}`,
};
const manifest = {
  schemaVersion: 1,
  channel,
  buildEnv,
  keyId,
  publishedAt: new Date().toISOString(),
  packages: [artifact],
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const signature = sign(
  null,
  manifestBytes,
  readFileSync(privateKeyPath, "utf-8"),
).toString("base64");
mkdirSync(feedRoot, { recursive: true });
atomicWrite(join(feedRoot, "manifest.sig"), `${signature}\n`);
atomicWrite(join(feedRoot, "manifest.json"), manifestBytes);

console.log(
  JSON.stringify(
    { manifest: join(feedRoot, "manifest.json"), ...artifact, keyId },
    null,
    2,
  ),
);
