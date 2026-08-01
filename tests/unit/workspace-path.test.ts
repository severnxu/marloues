import { describe, it, expect } from "vitest";
import { normalizeWorkspacePathForCompare, workspacePathsEqual } from "../../client/shared/workspace-path";

describe("workspace-path", () => {
  it("normalizes case, trailing slashes and backslashes", () => {
    expect(normalizeWorkspacePathForCompare("C:\\Users\\Me\\Code\\")).toBe("c:/users/me/code");
    expect(normalizeWorkspacePathForCompare("C:/Users/Me/Code")).toBe("c:/users/me/code");
  });

  it("treats empty / null input as empty string", () => {
    expect(normalizeWorkspacePathForCompare(null)).toBe("");
    expect(normalizeWorkspacePathForCompare(undefined)).toBe("");
    expect(normalizeWorkspacePathForCompare("   ")).toBe("");
  });

  it("compares equivalent paths as equal", () => {
    expect(workspacePathsEqual("C:\\Workspace\\Project", "c:/workspace/project/")).toBe(true);
    expect(workspacePathsEqual("/home/user/a", "/home/user/a/")).toBe(true);
  });

  it("treats different paths as unequal", () => {
    expect(workspacePathsEqual("/a/b", "/a/c")).toBe(false);
    expect(workspacePathsEqual("/a", "/a/b")).toBe(false);
  });

  it("returns false when either side is empty", () => {
    expect(workspacePathsEqual("", "/a")).toBe(false);
    expect(workspacePathsEqual(null, null)).toBe(false);
  });
});
