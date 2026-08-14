import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const args = argumentsMap(process.argv.slice(2));
if (args.has("help")) {
  console.log(`Usage: npm run key:hot -- --key-id <id> [options]

Creates an Ed25519 signing key. The private key is written under client/keys,
which is gitignored. The public key is added to the committed trust store.

Options:
  --key-id <id>          Required stable key identifier
  --private-key <path>   Private key output path
  --public-keys <path>   Public key trust-store JSON path`);
  process.exit(0);
}

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keyId = args.get("key-id") ?? "";
if (!/^[a-zA-Z0-9._-]+$/.test(keyId)) {
  throw new Error(
    "--key-id is required and may contain only letters, numbers, ., _, and -",
  );
}
const privateKeyPath = resolve(
  clientRoot,
  args.get("private-key") ?? `keys/hot-update-${keyId}-private.pem`,
);
const publicKeysPath = resolve(
  clientRoot,
  args.get("public-keys") ?? "resources/hot-update-public-keys.json",
);
if (existsSync(privateKeyPath)) {
  throw new Error(
    `Refusing to overwrite existing private key: ${privateKeyPath}`,
  );
}

const publicKeys = existsSync(publicKeysPath)
  ? JSON.parse(readFileSync(publicKeysPath, "utf-8"))
  : {};
if (publicKeys[keyId]) {
  throw new Error(`Public key id already exists: ${keyId}`);
}

const pair = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
mkdirSync(dirname(privateKeyPath), { recursive: true });
mkdirSync(dirname(publicKeysPath), { recursive: true });
writeFileSync(privateKeyPath, pair.privateKey, { mode: 0o600 });
writeFileSync(
  publicKeysPath,
  `${JSON.stringify({ ...publicKeys, [keyId]: pair.publicKey }, null, 2)}\n`,
  "utf-8",
);

console.log(
  JSON.stringify(
    {
      keyId,
      privateKey: privateKeyPath,
      publicKeys: publicKeysPath,
      warning: "Back up the private key securely, then store it in CI secrets.",
    },
    null,
    2,
  ),
);
