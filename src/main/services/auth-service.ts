import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AuthLoginResult, AuthSession, AuthStatus } from "@shared/types";
import { getAuthStorePath } from "../app-paths";
import { logInfo, logWarn } from "../core/logging/app-logger";

interface AuthStore {
  loggedOut?: boolean;
  session?: AuthSession & {
    createdAt?: number;
  };
}

const LOCAL_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function defaultLocalSession(): AuthSession {
  return {
    id: "local",
    username: "Marloues User",
    displayName: "Marloues User",
    provider: "local",
    expiresAt: Date.now() + LOCAL_SESSION_TTL_MS,
  };
}

export function getAuthStatus(): AuthStatus {
  const store = readAuthStore();
  if (store.loggedOut) {
    return {
      isAuthenticated: false,
      hasAccount: true,
      session: undefined,
    };
  }

  const session = readValidSession(store);
  if (store.session && !session) {
    writeAuthStore({ loggedOut: false });
  }

  return {
    isAuthenticated: true,
    hasAccount: true,
    session: session ?? defaultLocalSession(),
  };
}

export function openAuthPage(kind: "login" | "register"): AuthLoginResult {
  const session: AuthSession = {
    id: randomUUID(),
    username: "Marloues User",
    displayName: kind === "register" ? "Marloues User" : "Marloues User",
    provider: "local",
    expiresAt: Date.now() + LOCAL_SESSION_TTL_MS,
  };
  writeAuthStore({
    loggedOut: false,
    session: {
      ...session,
      createdAt: Date.now(),
    },
  });
  logInfo("auth.login", { provider: "local", kind });
  return {
    isAuthenticated: true,
    hasAccount: true,
    session,
    message: "Using local desktop authentication.",
  };
}

export function logout(): AuthStatus {
  writeAuthStore({ loggedOut: true });
  logInfo("auth.logout", { provider: "local" });
  return getAuthStatus();
}

function readValidSession(store: AuthStore): AuthSession | undefined {
  const session = store.session;
  if (!session || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return undefined;
  return {
    id: session.id,
    username: session.username,
    email: session.email,
    displayName: session.displayName,
    provider: session.provider,
    expiresAt: session.expiresAt,
  };
}

function readAuthStore(): AuthStore {
  const authPath = getAuthStorePath();
  if (!existsSync(authPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(authPath, "utf-8")) as AuthStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    logWarn("auth.readFailed", {
      authPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

function writeAuthStore(store: AuthStore): void {
  const authPath = getAuthStorePath();
  try {
    mkdirSync(dirname(authPath), { recursive: true });
    writeFileSync(authPath, JSON.stringify(store, null, 2), "utf-8");
  } catch (error) {
    logWarn("auth.writeFailed", {
      authPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
