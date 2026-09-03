import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false },
}));

import {
  importSkillSourceToRoot,
  inspectSkillImportSource,
} from "../../../../client/main/services/skill-service";

function manifest(name: string, version = "1.0.0"): string {
  return `---\nname: ${name}\ndescription: Local import test\nversion: ${version}\n---\n`;
}

describe("local Skill imports", () => {
  beforeEach(() => {
    process.env.MARLOUES_BUILD_ENV = "dev";
  });

  it("imports a complete Skill directory", () => {
    const root = mkdtempSync(join(tmpdir(), "marloues-skill-dir-"));
    const source = join(root, "directory-skill");
    const target = join(root, "installed");
    mkdirSync(join(source, "references"), { recursive: true });
    writeFileSync(join(source, "SKILL.md"), manifest("directory-skill"));
    writeFileSync(join(source, "references", "guide.md"), "# Guide\n");

    expect(inspectSkillImportSource(source)).toMatchObject({
      sourceKind: "directory",
      name: "directory-skill",
      version: "1.0.0",
      fileCount: 2,
      replacesExisting: false,
    });
    const imported = importSkillSourceToRoot(source, target);

    expect(imported.name).toBe("directory-skill");
    expect(
      readFileSync(
        join(target, "directory-skill", "references", "guide.md"),
        "utf8",
      ),
    ).toBe("# Guide\n");
  });

  it("imports a standalone SKILL.md", () => {
    const root = mkdtempSync(join(tmpdir(), "marloues-skill-md-"));
    const sourceDir = join(root, "source");
    const source = join(sourceDir, "SKILL.md");
    const target = join(root, "installed");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(source, manifest("single-file-skill", "2.1.0"));

    expect(inspectSkillImportSource(source)).toMatchObject({
      sourceKind: "manifest",
      name: "single-file-skill",
      version: "2.1.0",
      fileCount: 1,
    });
    importSkillSourceToRoot(source, target);

    expect(
      readFileSync(join(target, "single-file-skill", "SKILL.md"), "utf8"),
    ).toContain("name: single-file-skill");
  });

  it("imports a ZIP containing a complete Skill folder", () => {
    const root = mkdtempSync(join(tmpdir(), "marloues-skill-zip-"));
    const source = join(root, "archive-skill.zip");
    const target = join(root, "installed");
    writeFileSync(
      source,
      Buffer.from(
        zipSync({
          "archive-skill/SKILL.md": strToU8(manifest("archive-skill", "3.0.0")),
          "archive-skill/scripts/run.sh": strToU8("echo imported\n"),
        }),
      ),
    );

    expect(inspectSkillImportSource(source)).toMatchObject({
      sourceKind: "archive",
      name: "archive-skill",
      version: "3.0.0",
      fileCount: 2,
    });
    importSkillSourceToRoot(source, target);

    expect(
      readFileSync(join(target, "archive-skill", "scripts", "run.sh"), "utf8"),
    ).toBe("echo imported\n");
  });

  it("rejects unsupported files and ZIPs without a root SKILL.md", () => {
    const root = mkdtempSync(join(tmpdir(), "marloues-skill-invalid-"));
    const textFile = join(root, "README.md");
    const zipFile = join(root, "invalid.zip");
    writeFileSync(textFile, "not a Skill");
    writeFileSync(
      zipFile,
      Buffer.from(zipSync({ "package/README.md": strToU8("missing") })),
    );

    expect(() => inspectSkillImportSource(textFile)).toThrow("名为 SKILL.md");
    expect(() => inspectSkillImportSource(zipFile)).toThrow("SKILL.md");
  });
});
