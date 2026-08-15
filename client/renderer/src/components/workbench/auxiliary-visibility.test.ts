import { describe, expect, it } from "vitest";
import {
  getAuxiliarySessionScope,
  isAuxiliaryOpenForSession,
  updateAuxiliaryVisibilityForSession,
} from "./auxiliary-visibility";

describe("session auxiliary visibility", () => {
  it("keeps newly visited sessions closed while preserving the source session", () => {
    const sessionA = getAuxiliarySessionScope("session-a");
    const sessionB = getAuxiliarySessionScope("session-b");
    const openedInA = updateAuxiliaryVisibilityForSession(
      new Set<string>(),
      sessionA,
      true,
    );

    expect(isAuxiliaryOpenForSession(openedInA, sessionA)).toBe(true);
    expect(isAuxiliaryOpenForSession(openedInA, sessionB)).toBe(false);
  });

  it("restores each session independently after switching back", () => {
    const sessionA = getAuxiliarySessionScope("session-a");
    const sessionB = getAuxiliarySessionScope("session-b");
    let openSessions: ReadonlySet<string> = new Set();

    openSessions = updateAuxiliaryVisibilityForSession(
      openSessions,
      sessionA,
      true,
    );
    openSessions = updateAuxiliaryVisibilityForSession(
      openSessions,
      sessionB,
      true,
    );
    openSessions = updateAuxiliaryVisibilityForSession(
      openSessions,
      sessionB,
      false,
    );

    expect(isAuxiliaryOpenForSession(openSessions, sessionA)).toBe(true);
    expect(isAuxiliaryOpenForSession(openSessions, sessionB)).toBe(false);
  });
});
