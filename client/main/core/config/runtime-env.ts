import { app } from "electron";

export type MarlouesBuildEnv = "dev" | "oa" | "prod";

export function readMarlouesBuildEnv(): MarlouesBuildEnv {
  const raw = (process.env.MARLOUES_BUILD_ENV || process.env.BUILD_ENV || defaultBuildEnv()).trim().toLowerCase();
  return raw === "oa" || raw === "prod" || raw === "dev" ? raw : defaultBuildEnv();
}

function defaultBuildEnv(): MarlouesBuildEnv {
  return app?.isPackaged ? "prod" : "dev";
}
