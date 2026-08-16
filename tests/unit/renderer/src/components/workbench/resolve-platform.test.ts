import { describe, expect, it } from "vitest";
import { resolveWorkbenchPlatform } from "../../../../../../client/renderer/src/components/workbench/resolve-platform";

describe("resolveWorkbenchPlatform", () => {
  it.each(["darwin", "macos"])("maps %s to macOS", (platform) => {
    expect(resolveWorkbenchPlatform(platform)).toBe("macos");
  });

  it.each(["win32", "windows", "linux"])(
    "maps %s to the standard window shell",
    (platform) => {
      expect(resolveWorkbenchPlatform(platform)).toBe("windows");
    },
  );

  it("prefers the preview override", () => {
    expect(resolveWorkbenchPlatform("win32", "macos")).toBe("macos");
    expect(resolveWorkbenchPlatform("darwin", "windows")).toBe("windows");
  });
});
