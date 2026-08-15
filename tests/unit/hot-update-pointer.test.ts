import { describe, expect, it } from "vitest";
import {
  activatePendingVersion,
  confirmReadyVersion,
  failPackageVersion,
  recoverInterruptedBoot,
} from "../../client/main/hot-update/pointer-state";
import type { InstalledUiPointer } from "../../client/shared/hot-update";

const base = (): InstalledUiPointer => ({
  activeVersion: "1.1.0",
  lastGoodVersion: "1.1.0",
  pendingVersion: "1.2.0",
  updatedAt: "2026-08-14T00:00:00.000Z",
});

describe("UI package pointer transitions", () => {
  it("activates a pending version and records a rollback target", () => {
    expect(activatePendingVersion(base())).toMatchObject({
      activeVersion: "1.2.0",
      previousVersion: "1.1.0",
      bootingVersion: "1.2.0",
      pendingVersion: undefined,
    });
  });

  it("marks a ready renderer as the last known good version", () => {
    const booting = activatePendingVersion(base());
    expect(confirmReadyVersion(booting, "1.2.0")).toMatchObject({
      activeVersion: "1.2.0",
      lastGoodVersion: "1.2.0",
      bootingVersion: undefined,
    });
  });

  it("rolls back and quarantines failed or interrupted versions", () => {
    const booting = activatePendingVersion(base());
    expect(failPackageVersion(booting, "1.2.0")).toMatchObject({
      activeVersion: "1.1.0",
      failedVersions: ["1.2.0"],
      bootingVersion: undefined,
    });
    expect(recoverInterruptedBoot(booting)).toMatchObject({
      activeVersion: "1.1.0",
      failedVersions: ["1.2.0"],
      bootingVersion: undefined,
    });
  });
});
