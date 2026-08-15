import { describe, expect, it } from "vitest";
import { resolveTaskContextMode } from "./use-task-context-layout";

describe("resolveTaskContextMode", () => {
  it("keeps the source summary closed until the user opens it", () => {
    expect(
      resolveTaskContextMode({
        available: true,
        preference: "auto",
        wide: true,
      }),
    ).toBe("hidden");
  });

  it("pins an explicitly opened summary on a wide primary surface", () => {
    expect(
      resolveTaskContextMode({
        available: true,
        preference: "open",
        wide: true,
      }),
    ).toBe("docked");
  });

  it("hides automatically on a narrow primary surface", () => {
    expect(
      resolveTaskContextMode({
        available: true,
        preference: "auto",
        wide: false,
      }),
    ).toBe("hidden");
  });

  it("floats when the user explicitly opens it on a narrow surface", () => {
    expect(
      resolveTaskContextMode({
        available: true,
        preference: "open",
        wide: false,
      }),
    ).toBe("floating");
  });

  it("never renders without task data", () => {
    expect(
      resolveTaskContextMode({
        available: false,
        preference: "open",
        wide: true,
      }),
    ).toBe("hidden");
  });
});
