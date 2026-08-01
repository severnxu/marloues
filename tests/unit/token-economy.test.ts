import { describe, it, expect } from "vitest";
import { compressToolResult, compressToolDescription } from "../../client/main/core/context/token-economy";

function noiseLines(count: number, charsPerLine = 210): string {
  return Array.from({ length: count }, (_, i) => `noise ${i} `.repeat(Math.ceil(charsPerLine / 7))).join("\n");
}

describe("token-economy", () => {
  it("returns input unchanged when under budget", () => {
    const result = compressToolResult("short output");
    expect(result.meta.compressed).toBe(false);
    expect(result.modelText).toBe("short output");
    expect(result.meta.omittedChars).toBe(0);
    expect(result.meta.strategy).toEqual([]);
  });

  it("compresses oversized output", () => {
    const text = noiseLines(200);
    expect(text.length).toBeGreaterThan(12_000);
    const result = compressToolResult(text);
    expect(result.meta.compressed).toBe(true);
    expect(result.modelText.length).toBeLessThan(text.length);
    expect(result.meta.omittedChars).toBeGreaterThan(0);
    expect(result.meta.strategy.length).toBeGreaterThan(0);
  });

  it("preserves code blocks while compressing", () => {
    const text = "```ts\nconst x = 1;\n```\n" + noiseLines(300);
    const result = compressToolResult(text);
    expect(result.meta.compressed).toBe(true);
    expect(result.meta.preserved.codeBlocks).toBeGreaterThan(0);
    expect(result.modelText).toContain("const x = 1;");
  });

  it("preserves urls and paths while compressing", () => {
    const text = "https://example.com/a/b\nC:/Users/x/file.ts\n" + noiseLines(300);
    const result = compressToolResult(text);
    expect(result.meta.preserved.urls).toBeGreaterThan(0);
    expect(result.meta.preserved.paths).toBeGreaterThan(0);
    expect(result.modelText).toContain("https://example.com/a/b");
    expect(result.modelText).toContain("C:/Users/x/file.ts");
  });

  it("strips ANSI escape codes", () => {
    const result = compressToolResult("\u001b[31mred\u001b[0m");
    expect(result.rawText).toBe("red");
  });

  it("handles null / undefined output", () => {
    expect(compressToolResult(null).rawText).toBe("");
    expect(compressToolResult(undefined).rawText).toBe("");
  });

  it("stringifies object output", () => {
    const result = compressToolResult({ ok: true });
    expect(result.rawText).toContain('"ok"');
  });

  it("compressToolDescription short-circuits and truncates long descriptions", () => {
    expect(compressToolDescription("short desc")).toBe("short desc");
    const long = "word ".repeat(500);
    const out = compressToolDescription(long, 100);
    expect(out).toContain("[description truncated]");
    expect(out.length).toBeLessThanOrEqual(110);
  });
});
