import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("electron", () => ({ app: undefined }));

import { readMarlouesBuildEnv, resolveMarlouesBuildEnv } from "../../client/main/core/config/runtime-env";

describe("runtime-env", () => {
  const original = {
    marloues: process.env.MARLOUES_BUILD_ENV,
    build: process.env.BUILD_ENV,
  };

  beforeEach(() => {
    delete process.env.MARLOUES_BUILD_ENV;
    delete process.env.BUILD_ENV;
  });

  afterEach(() => {
    if (original.marloues !== undefined) process.env.MARLOUES_BUILD_ENV = original.marloues;
    if (original.build !== undefined) process.env.BUILD_ENV = original.build;
  });

  it("defaults to dev when no env is set", () => {
    expect(readMarlouesBuildEnv()).toBe("dev");
  });

  it("accepts dev / oa / prod", () => {
    process.env.MARLOUES_BUILD_ENV = "dev";
    expect(readMarlouesBuildEnv()).toBe("dev");
    process.env.MARLOUES_BUILD_ENV = "oa";
    expect(readMarlouesBuildEnv()).toBe("oa");
    process.env.MARLOUES_BUILD_ENV = "prod";
    expect(readMarlouesBuildEnv()).toBe("prod");
  });

  it("is case-insensitive", () => {
    process.env.MARLOUES_BUILD_ENV = "OA";
    expect(readMarlouesBuildEnv()).toBe("oa");
  });

  it("falls back to dev on invalid values", () => {
    process.env.MARLOUES_BUILD_ENV = "sit";
    expect(readMarlouesBuildEnv()).toBe("dev");
    process.env.MARLOUES_BUILD_ENV = "production";
    expect(readMarlouesBuildEnv()).toBe("dev");
  });

  it("MARLOUES_BUILD_ENV takes precedence over BUILD_ENV", () => {
    process.env.BUILD_ENV = "prod";
    process.env.MARLOUES_BUILD_ENV = "dev";
    expect(readMarlouesBuildEnv()).toBe("dev");
  });

  it("defaults packaged applications to prod", () => {
    expect(resolveMarlouesBuildEnv({ isPackaged: true })).toBe("prod");
  });

  it("does not allow a packaged application to downgrade to dev", () => {
    expect(resolveMarlouesBuildEnv({ isPackaged: true, marlouesBuildEnv: "dev" })).toBe("prod");
  });

  it("allows a packaged application to select the OA policy", () => {
    expect(resolveMarlouesBuildEnv({ isPackaged: true, marlouesBuildEnv: "oa" })).toBe("oa");
  });
});
