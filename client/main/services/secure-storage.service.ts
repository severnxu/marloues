import { safeStorage } from "electron";
import { SECRET_ENCRYPTION_UNAVAILABLE_CODE } from "@shared/types";

const SAFE_PREFIX = "enc:safe:v1:";
const LEGACY_FALLBACK_PREFIX = "enc:fallback:v1:";

export interface SecretStorageBackend {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class SecretEncryptionUnavailableError extends Error {
  readonly code = SECRET_ENCRYPTION_UNAVAILABLE_CODE;

  constructor(cause?: unknown) {
    super(
      `${SECRET_ENCRYPTION_UNAVAILABLE_CODE}: System credential storage is unavailable, so the secret was not saved. Unlock or configure the OS credential store and try again.`,
    );
    this.name = "SecretEncryptionUnavailableError";
    if (cause !== undefined) this.cause = cause;
  }
}

export function createSecretStorageService(storage: SecretStorageBackend) {
  function isSecretEncryptionAvailable(): boolean {
    try {
      return storage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  function encryptSecret(value: string | undefined): string | undefined {
    if (!value || value.startsWith(SAFE_PREFIX)) return value;

    const plaintext = value.startsWith(LEGACY_FALLBACK_PREFIX)
      ? decodeLegacyFallback(value)
      : value;

    try {
      if (!storage.isEncryptionAvailable()) {
        throw new SecretEncryptionUnavailableError();
      }
    } catch (error) {
      if (error instanceof SecretEncryptionUnavailableError) throw error;
      throw new SecretEncryptionUnavailableError(error);
    }

    try {
      return `${SAFE_PREFIX}${storage.encryptString(plaintext).toString("base64")}`;
    } catch (error) {
      throw new SecretEncryptionUnavailableError(error);
    }
  }

  function decryptSecret(value: string | undefined): string | undefined {
    if (!value) return value;
    try {
      if (value.startsWith(SAFE_PREFIX)) {
        return storage.decryptString(Buffer.from(value.slice(SAFE_PREFIX.length), "base64"));
      }
      if (value.startsWith(LEGACY_FALLBACK_PREFIX)) {
        return decodeLegacyFallback(value);
      }
    } catch {
      return undefined;
    }
    return value;
  }

  return {
    decryptSecret,
    encryptSecret,
    isSecretEncryptionAvailable,
  };
}

const secretStorageService = createSecretStorageService(safeStorage);

export function isSecretEncryptionAvailable(): boolean {
  return secretStorageService.isSecretEncryptionAvailable();
}

export function encryptSecret(value: string | undefined): string | undefined {
  return secretStorageService.encryptSecret(value);
}

export function decryptSecret(value: string | undefined): string | undefined {
  return secretStorageService.decryptSecret(value);
}

export function isEncryptedSecret(value: string | undefined): boolean {
  return Boolean(value?.startsWith(SAFE_PREFIX) || value?.startsWith(LEGACY_FALLBACK_PREFIX));
}

export function isLegacyPlaintextSecret(value: string | undefined): boolean {
  return Boolean(value?.startsWith(LEGACY_FALLBACK_PREFIX));
}

function decodeLegacyFallback(value: string): string {
  return Buffer.from(value.slice(LEGACY_FALLBACK_PREFIX.length), "base64").toString("utf8");
}
