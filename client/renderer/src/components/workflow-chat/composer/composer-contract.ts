import type { SkillInfo } from "@shared/types";
import type { WorkflowUserMessageContent } from "@shared/workflow-read-thread-contract";
import type { ComposerAttachment } from "./composer-attachments";

export const MAX_WORKSPACE_MENTIONS = 500;
export const MAX_WORKSPACE_MENTION_DEPTH = 5;

export interface ComposerSuggestionQuery {
  kind: "command" | "skill" | "mention";
  query: string;
  start: number;
  end: number;
}

export function composerSuggestionQuery(
  value: string,
  caret: number,
): ComposerSuggestionQuery | null {
  const before = value.slice(0, caret);
  const match = before.match(/(?:^|\s)([$@/])([\p{L}\p{N}\p{M}.:_/\\-]*)$/u);
  if (!match || match.index == null) return null;
  const whitespace = match[0].length - match[0].trimStart().length;
  return {
    kind: match[1] === "$" ? "skill" : match[1] === "@" ? "mention" : "command",
    query: match[2] ?? "",
    start: match.index + whitespace,
    end: caret,
  };
}

export function replaceComposerSuggestion(
  value: string,
  query: ComposerSuggestionQuery,
  replacement: string,
): { value: string; caret: number } {
  const suffix = replacement ? " " : "";
  const next = `${value.slice(0, query.start)}${replacement}${suffix}${value.slice(query.end)}`;
  return {
    value: next,
    caret: query.start + replacement.length + suffix.length,
  };
}

export function composerAttachmentsToContent(
  attachments: ComposerAttachment[],
): WorkflowUserMessageContent[] {
  return attachments.map((attachment) => {
    switch (attachment.kind) {
      case "image":
        return { type: "image", url: attachment.dataUrl, detail: "auto" };
      case "file":
        return {
          type: "file",
          name: attachment.name,
          mimeType: attachment.mimeType,
          text: attachment.text,
        };
      case "url":
        return { type: "url", url: attachment.url };
      case "mention":
        return {
          type: "mention",
          name: attachment.name,
          path: attachment.path,
        };
      case "skill":
        return {
          type: "skill",
          id: attachment.skill.id,
          name: attachment.skill.name,
          displayName: attachment.skill.name,
          path: attachment.skill.path,
          description: attachment.skill.description,
          scope: attachment.skill.scope,
          version: attachment.skill.version,
        };
    }
  });
}

export function selectedSkillAttachment(skill: SkillInfo): ComposerAttachment {
  return {
    kind: "skill",
    id: crypto.randomUUID(),
    skill,
    name: skill.name,
    command: `$${skill.name}`,
    path: skill.path,
  };
}

export function skillIdentityFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const plugin = normalized.match(
    /^plugin:\/\/([^/]+)\/skills\/(?:\.system\/)?(.+?)\/SKILL\.md$/i,
  );
  if (plugin) return `plugin:${plugin[1]}:${plugin[2]}`;
  const skill = normalized.match(/\/skills\/(?:\.system\/)?(.+?)\/SKILL\.md$/i);
  return skill ? `skill:${skill[1]}` : `path:${normalized.toLowerCase()}`;
}
