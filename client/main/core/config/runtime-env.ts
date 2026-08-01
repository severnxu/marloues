import { app } from "electron";

export type MarlouesBuildEnv = "dev" | "oa" | "prod";

export function readMarlouesBuildEnv(): MarlouesBuildEnv {
  return resolveMarlouesBuildEnv({
    isPackaged: Boolean(app?.isPackaged),
    marlouesBuildEnv: process.env.MARLOUES_BUILD_ENV,
    buildEnv: process.env.BUILD_ENV,
  });
}

export function resolveMarlouesBuildEnv(input: {
  isPackaged: boolean;
  marlouesBuildEnv?: string;
  buildEnv?: string;
}): MarlouesBuildEnv {
  const fallback: MarlouesBuildEnv = input.isPackaged ? "prod" : "dev";
  const raw = (input.marlouesBuildEnv || input.buildEnv || fallback)
    .trim()
    .toLowerCase();
  const parsed =
    raw === "oa" || raw === "prod" || raw === "dev" ? raw : fallback;

  // A packaged application must never be downgraded to the permissive dev policy
  // by a launch-time environment variable.
  return input.isPackaged && parsed === "dev" ? "prod" : parsed;
}
