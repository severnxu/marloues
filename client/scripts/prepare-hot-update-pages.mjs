import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHANNELS = ["stable", "beta", "nightly"];
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_SIGNATURE_BYTES = 64 * 1024;
const MAX_PACKAGE_BYTES = 250 * 1024 * 1024;

function argumentsMap(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
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

function requireChannel(value) {
  if (!CHANNELS.includes(value)) {
    throw new Error(`Unsupported update channel: ${value}`);
  }
  return value;
}

function safeDestination(root, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Unsafe feed path: ${String(relativePath)}`);
  }
  const normalized = relativePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe feed path: ${relativePath}`);
  }
  const destination = resolve(root, ...segments);
  const resolvedRoot = resolve(root);
  if (
    destination !== resolvedRoot &&
    !destination.startsWith(`${resolvedRoot}${sep}`)
  ) {
    throw new Error(`Feed path escapes output root: ${relativePath}`);
  }
  return destination;
}

function copyDirectory(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      copyFileSync(sourcePath, destinationPath);
    } else {
      throw new Error(`Unsupported feed entry: ${sourcePath}`);
    }
  }
}

async function fetchBytes(fetchImpl, url, maximumBytes, allowMissing = false) {
  const response = await fetchImpl(url, { redirect: "follow" });
  if (allowMissing && response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`Unable to preserve ${url}: HTTP ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`Remote feed file exceeds size limit: ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maximumBytes) {
    throw new Error(`Remote feed file exceeds size limit: ${url}`);
  }
  return bytes;
}

async function preserveChannel({ baseUrl, channel, destination, fetchImpl }) {
  const channelUrl = new URL(`${channel}/`, baseUrl);
  const manifestUrl = new URL("manifest.json", channelUrl);
  const manifestBytes = await fetchBytes(
    fetchImpl,
    manifestUrl,
    MAX_MANIFEST_BYTES,
    true,
  );
  if (!manifestBytes) return false;
  const manifest = JSON.parse(manifestBytes.toString("utf-8"));
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.channel !== channel ||
    !Array.isArray(manifest.packages) ||
    manifest.packages.length === 0
  ) {
    throw new Error(`Existing ${channel} feed manifest is invalid`);
  }
  const signatureBytes = await fetchBytes(
    fetchImpl,
    new URL("manifest.sig", channelUrl),
    MAX_SIGNATURE_BYTES,
  );

  mkdirSync(destination, { recursive: true });
  for (const artifact of manifest.packages) {
    if (typeof artifact?.url !== "string" || artifact.url.length === 0) {
      throw new Error(`Existing ${channel} package URL is invalid`);
    }
    const artifactUrl = new URL(artifact?.url, manifestUrl);
    if (artifactUrl.origin !== manifestUrl.origin) {
      throw new Error(`Existing ${channel} package must use the feed origin`);
    }
    const packagePath = safeDestination(destination, artifact.url);
    const packageBytes = await fetchBytes(
      fetchImpl,
      artifactUrl,
      MAX_PACKAGE_BYTES,
    );
    mkdirSync(dirname(packagePath), { recursive: true });
    writeFileSync(packagePath, packageBytes);
  }
  writeFileSync(join(destination, "manifest.sig"), signatureBytes);
  writeFileSync(join(destination, "manifest.json"), manifestBytes);
  return true;
}

export async function preparePagesArtifact({
  channel,
  feedRoot,
  outputRoot,
  baseUrl,
  fetchImpl = fetch,
}) {
  const selectedChannel = requireChannel(channel);
  const source = resolve(feedRoot);
  const output = resolve(outputRoot);
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    throw new Error(`Signed feed directory not found: ${source}`);
  }
  if (existsSync(output)) {
    throw new Error(`Pages output directory already exists: ${output}`);
  }
  const normalizedBaseUrl = new URL(
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );
  if (normalizedBaseUrl.protocol !== "https:") {
    throw new Error("GitHub Pages feed URL must use HTTPS");
  }

  const uiRoot = join(output, "ui");
  const selectedDestination = join(uiRoot, selectedChannel);
  copyDirectory(source, selectedDestination);
  const preservedChannels = [];
  for (const existingChannel of CHANNELS) {
    if (existingChannel === selectedChannel) continue;
    const preserved = await preserveChannel({
      baseUrl: normalizedBaseUrl,
      channel: existingChannel,
      destination: join(uiRoot, existingChannel),
      fetchImpl,
    });
    if (preserved) preservedChannels.push(existingChannel);
  }
  writeFileSync(join(output, ".nojekyll"), "", "utf-8");
  return {
    output,
    selectedChannel,
    preservedChannels,
    relativeFeed: relative(output, selectedDestination).replaceAll("\\", "/"),
  };
}

async function main() {
  const args = argumentsMap(process.argv.slice(2));
  if (args.has("help")) {
    console.log(
      `Usage: npm run prepare:hot-pages -- --channel stable --feed <path> --output <path> --base-url <url>`,
    );
    return;
  }
  const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const channel = args.get("channel") ?? "stable";
  const feedRoot = resolve(
    clientRoot,
    args.get("feed") ?? `release/hot/${channel}`,
  );
  const outputValue = args.get("output");
  const baseUrl = args.get("base-url") ?? process.env.MARLOUES_HOT_UPDATE_URL;
  if (!outputValue) throw new Error("--output is required");
  if (!baseUrl) throw new Error("--base-url is required");
  const result = await preparePagesArtifact({
    channel,
    feedRoot,
    outputRoot: resolve(clientRoot, outputValue),
    baseUrl,
  });
  console.log(JSON.stringify(result, null, 2));
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  await main();
}
