import { safeStorage } from "electron";

const SAFE_PREFIX = "enc:safe:v1:";
const FALLBACK_PREFIX = "enc:fallback:v1:";

export function encryptSecret(value: string | undefined): string | undefined {
  if (!value || isEncryptedSecret(value)) return value;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `${SAFE_PREFIX}${safeStorage.encryptString(value).toString("base64")}`;
    }
  } catch {
    return fallbackEncode(value);
  }
  return fallbackEncode(value);
}

export function decryptSecret(value: string | undefined): string | undefined {
  if (!value) return value;
  try {
    if (value.startsWith(SAFE_PREFIX)) {
      return safeStorage.decryptString(Buffer.from(value.slice(SAFE_PREFIX.length), "base64"));
    }
    if (value.startsWith(FALLBACK_PREFIX)) {
      return Buffer.from(value.slice(FALLBACK_PREFIX.length), "base64").toString("utf8");
    }
  } catch {
    return undefined;
  }
  return value;
}

export function isEncryptedSecret(value: string | undefined): boolean {
  return Boolean(value?.startsWith(SAFE_PREFIX) || value?.startsWith(FALLBACK_PREFIX));
}

function fallbackEncode(value: string): string {
  return `${FALLBACK_PREFIX}${Buffer.from(value, "utf8").toString("base64")}`;
}
