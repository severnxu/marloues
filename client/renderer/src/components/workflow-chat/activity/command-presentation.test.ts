import { describe, expect, it } from "vitest";
import {
  cleanCommandOutput,
  formatShellLabel,
  inferShellLabel,
  readableCommandLabel,
} from "./command-presentation";

describe("command presentation", () => {
  it("removes execution metadata while preserving command output", () => {
    expect(
      cleanCommandOutput(
        "Exit code: 0\nWall time: 0.4 seconds\nOutput:\n71 tests passed",
      ),
    ).toBe("71 tests passed");
  });

  it("maps common commands to concise activity labels", () => {
    expect(readableCommandLabel("git status --short")).toBe("已检查 Git 状态");
    expect(readableCommandLabel("rg -n workflow src")).toBe("已搜索工作区");
    expect(readableCommandLabel("Get-Content src/main.ts")).toBe(
      "已读取 main.ts",
    );
  });

  it("normalizes explicit shells and infers PowerShell commands", () => {
    expect(formatShellLabel("pwsh.exe")).toBe("PowerShell");
    expect(formatShellLabel("/bin/zsh")).toBe("Zsh");
    expect(inferShellLabel("Get-ChildItem src")).toBe("PowerShell");
  });
});
