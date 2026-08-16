import { describe, expect, it } from "vitest";
import {
  composerAttachmentsToContent,
  composerSuggestionQuery,
  replaceComposerSuggestion,
  selectedSkillAttachment,
} from "../../../../../../../client/renderer/src/components/workflow-chat/composer/composer-contract";

describe("composer contract", () => {
  it("parses unicode command, skill and mention tokens at the caret", () => {
    expect(composerSuggestionQuery("前文 $图片-生成", 8)?.kind).toBe("skill");
    expect(composerSuggestionQuery("引用 @src/组件.tsx", 14)?.kind).toBe(
      "mention",
    );
    expect(composerSuggestionQuery("/compact", 8)?.kind).toBe("command");
  });

  it("replaces only the active token and preserves surrounding text", () => {
    const query = composerSuggestionQuery("前文 $img 后文", 7)!;
    expect(replaceComposerSuggestion("前文 $img 后文", query, "")).toEqual({
      value: "前文  后文",
      caret: 3,
    });
  });

  it("serializes exact skill identity in attachment order", () => {
    const skill = selectedSkillAttachment({
      id: "skill-1",
      name: "imagegen",
      path: "C:/skills/imagegen/SKILL.md",
      scope: "user",
      enabled: true,
      version: "1.2.0",
    });
    expect(composerAttachmentsToContent([skill])).toEqual([
      expect.objectContaining({
        type: "skill",
        id: "skill-1",
        name: "imagegen",
        path: "C:/skills/imagegen/SKILL.md",
        version: "1.2.0",
      }),
    ]);
  });
});
