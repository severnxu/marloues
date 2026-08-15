declare const __MARLOUES_BUILD_ENV__: string | undefined;
declare const __MARLOUES_CLIENT_UPDATE_PROVIDER__: string | undefined;
declare const __MARLOUES_CLIENT_UPDATE_URL__: string | undefined;
declare const __MARLOUES_HOT_UPDATE_URL__: string | undefined;
declare const __MARLOUES_HOT_UPDATE_PUBLIC_KEYS__:
  Record<string, string> | undefined;

type ClientUpdateProvider = "github" | "generic";

function configuredString(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

const provider = configuredString(
  typeof __MARLOUES_CLIENT_UPDATE_PROVIDER__ === "string"
    ? __MARLOUES_CLIENT_UPDATE_PROVIDER__
    : undefined,
);

export const MARLOUES_UPDATE_CONFIG = {
  buildEnv:
    configuredString(
      typeof __MARLOUES_BUILD_ENV__ === "string"
        ? __MARLOUES_BUILD_ENV__
        : undefined,
    ) || "development",
  clientProvider: (provider === "generic"
    ? "generic"
    : "github") as ClientUpdateProvider,
  clientUpdateUrl: configuredString(
    typeof __MARLOUES_CLIENT_UPDATE_URL__ === "string"
      ? __MARLOUES_CLIENT_UPDATE_URL__
      : undefined,
  ),
  hotUpdateUrl: configuredString(
    typeof __MARLOUES_HOT_UPDATE_URL__ === "string"
      ? __MARLOUES_HOT_UPDATE_URL__
      : undefined,
  ),
  hotUpdatePublicKeys:
    typeof __MARLOUES_HOT_UPDATE_PUBLIC_KEYS__ === "object" &&
    __MARLOUES_HOT_UPDATE_PUBLIC_KEYS__
      ? __MARLOUES_HOT_UPDATE_PUBLIC_KEYS__
      : {},
} as const;
