import { readMarlouesBuildEnv, type MarlouesBuildEnv } from "../core/config/runtime-env";

export interface SkillRuntimePolicy {
  env: MarlouesBuildEnv;
  marketplaceOnly: boolean;
  requireSignature: boolean;
  verifyIntegrityOnRun: boolean;
  allowLocalImport: boolean;
  allowMutableLocalSkills: boolean;
}

const POLICIES: Record<MarlouesBuildEnv, Omit<SkillRuntimePolicy, "env">> = {
  dev: {
    marketplaceOnly: false,
    requireSignature: false,
    verifyIntegrityOnRun: false,
    allowLocalImport: true,
    allowMutableLocalSkills: true,
  },
  oa: {
    marketplaceOnly: false,
    requireSignature: true,
    verifyIntegrityOnRun: true,
    allowLocalImport: false,
    allowMutableLocalSkills: false,
  },
  prod: {
    marketplaceOnly: true,
    requireSignature: true,
    verifyIntegrityOnRun: true,
    allowLocalImport: false,
    allowMutableLocalSkills: false,
  },
};

export function getSkillRuntimePolicy(): SkillRuntimePolicy {
  const env = readMarlouesBuildEnv();
  const base = POLICIES[env];
  if (env !== "dev") return { env, ...base };

  return {
    env,
    ...base,
    allowLocalImport: readBooleanOverride("MARLOUES_ALLOW_LOCAL_SKILL_IMPORT", base.allowLocalImport),
    allowMutableLocalSkills: readBooleanOverride("MARLOUES_ALLOW_MUTABLE_SKILLS", base.allowMutableLocalSkills),
    verifyIntegrityOnRun: readBooleanOverride("MARLOUES_SKIP_SKILL_INTEGRITY_CHECK", base.verifyIntegrityOnRun, {
      invert: true,
    }),
  };
}

function readBooleanOverride(name: string, fallback: boolean, options: { invert?: boolean } = {}): boolean {
  const raw = process.env[name]?.trim();
  if (raw === undefined) return fallback;
  const enabled = raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
  return options.invert ? !enabled : enabled;
}
