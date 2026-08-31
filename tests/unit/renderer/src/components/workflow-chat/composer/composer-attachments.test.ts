import { describe, expect, it, vi } from "vitest";
import {
  MAX_ATTACHMENTS,
  attachmentsToUserContent,
  browserCommentAttachment,
  isMatchingBrowserCommentAttachment,
  isTextFile,
  isUrl,
  skillAttachment,
  urlAttachment,
} from "../../../../../../../client/renderer/src/components/workflow-chat/composer/composer-attachments";

// crypto.randomUUID is not available in the vitest jsdom env by default.
vi.stubGlobal("crypto", {
  randomUUID: () => "test-uuid-" + Math.random().toString(36).slice(2, 8),
});

describe("skillAttachment", () => {
  it("creates a skill attachment with name and command", () => {
    const att = skillAttachment("imagegen", "/imagegen");
    expect(att.kind).toBe("skill");
    // Narrow to the skill variant so TS exposes command/path.
    expect(att.kind).toBe("skill");
    if (att.kind !== "skill") throw new Error("not a skill");
    expect(att.name).toBe("imagegen");
    expect(att.command).toBe("/imagegen");
    expect(att.path).toBeUndefined();
    expect(att.id).toBeTruthy();
  });

  it("preserves optional path when provided", () => {
    const att = skillAttachment("imagegen", "/imagegen", "/skills/imagegen");
    if (att.kind !== "skill") throw new Error("not a skill");
    expect(att.path).toBe("/skills/imagegen");
  });
});

describe("attachmentsToUserContent — skill", () => {
  it("maps skill attachment to skill content part", () => {
    const att = skillAttachment("imagegen", "/imagegen");
    const content = attachmentsToUserContent([att]);
    expect(content).toEqual([
      expect.objectContaining({ type: "skill", name: "imagegen" }),
    ]);
  });

  it("maps skill with path when provided", () => {
    const att = skillAttachment(
      "frontend-design-pro",
      "/frontend-design-pro",
      "/skills/fdp",
    );
    const content = attachmentsToUserContent([att]);
    expect(content).toEqual([
      expect.objectContaining({
        type: "skill",
        name: "frontend-design-pro",
        path: "/skills/fdp",
      }),
    ]);
  });
});

describe("attachmentsToUserContent — mixed", () => {
  it("preserves attachment order across kinds", () => {
    const url = urlAttachment("https://example.com");
    const skill = skillAttachment("imagegen", "/imagegen");
    const content = attachmentsToUserContent([url, skill]);
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "url", url: "https://example.com" });
    expect(content[1]).toEqual(
      expect.objectContaining({ type: "skill", name: "imagegen" }),
    );
  });
});

describe("browser comment attachment identity", () => {
  const payload = {
    commentId: 2,
    targetType: "element" as const,
    ref: "body > main > button",
    tagName: "BUTTON",
    text: "提交",
    attributes: {},
    rect: { x: 10, y: 20, width: 80, height: 32 },
    viewport: { width: 1280, height: 720 },
    scrollX: 0,
    scrollY: 0,
    comment: "按钮间距需要调整",
  };

  it("keeps page identity in the composer but not in sent content", () => {
    const attachment = browserCommentAttachment(payload, "page-1");
    expect(attachment).toEqual(
      expect.objectContaining({ kind: "browser-comment", pageId: "page-1" }),
    );
    expect(attachmentsToUserContent([attachment])).toEqual([
      { type: "browserComment", ...payload },
    ]);
  });

  it("matches only the exact page and comment id", () => {
    const attachment = browserCommentAttachment(payload, "page-1");
    expect(isMatchingBrowserCommentAttachment(attachment, "page-1", 2)).toBe(
      true,
    );
    expect(isMatchingBrowserCommentAttachment(attachment, "page-2", 2)).toBe(
      false,
    );
    expect(isMatchingBrowserCommentAttachment(attachment, "page-1", 3)).toBe(
      false,
    );
  });
});

describe("MAX_ATTACHMENTS", () => {
  it("counts skill attachments against the limit", () => {
    // Skills, files, images, and urls all share the same MAX_ATTACHMENTS budget.
    const skills = Array.from({ length: MAX_ATTACHMENTS }, (_, i) =>
      skillAttachment(`skill-${i}`, `/skill-${i}`),
    );
    expect(skills.length).toBe(MAX_ATTACHMENTS);
    expect(attachmentsToUserContent(skills).length).toBe(MAX_ATTACHMENTS);
  });
});

// ── Existing helpers used by the composer (light smoke) ──

describe("isUrl", () => {
  it("accepts http and https", () => {
    expect(isUrl("https://example.com")).toBe(true);
    expect(isUrl("http://localhost:3000")).toBe(true);
  });

  it("rejects non-url strings", () => {
    expect(isUrl("not a url")).toBe(false);
    expect(isUrl("/local/path")).toBe(false);
  });
});

describe("isTextFile", () => {
  it("rejects images", () => {
    const file = new File([""], "test.png", { type: "image/png" });
    expect(isTextFile(file)).toBe(false);
  });

  it("accepts plain text", () => {
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    expect(isTextFile(file)).toBe(true);
  });

  it("accepts conventional extensionless config examples", () => {
    const file = new File(["API_URL=https://example.com"], ".env.example");
    expect(isTextFile(file)).toBe(true);
  });
});
