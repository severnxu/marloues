import type { WorkflowUserMessageContent } from "@shared/workflow-read-thread-contract";

export type WorkflowUserMessageImage = Extract<
  WorkflowUserMessageContent,
  { type: "image" | "localImage" }
>;

export type WorkflowUserMessageAttachment =
  | { kind: "parent-context"; sourceThreadId?: string }
  | { kind: "prior-conversation"; count: number }
  | { kind: "mcp-app-context"; app?: string }
  | { kind: "application"; name: string; path?: string }
  | {
      kind: "file";
      name: string;
      path?: string;
      mimeType?: string;
      text?: string;
    }
  | { kind: "url"; url: string; title?: string }
  | {
      kind: "skill";
      name: string;
      path?: string;
      id?: string;
      displayName?: string;
    }
  | { kind: "mention"; name: string; path?: string }
  | { kind: "pull-request-merge"; count: number }
  | { kind: "pull-request-checks"; count: number }
  | { kind: "pull-request-conflict"; count: number }
  | { kind: "response-annotations"; count: number }
  | { kind: "diff-comments"; count: number }
  | { kind: "browser-comments"; count: number }
  | { kind: "selected-text"; count: number };

export interface WorkflowUserMessagePresentation {
  /** Raw protocol order. Never sort or deduplicate this sequence. */
  protocolContent: WorkflowUserMessageContent[];
  images: WorkflowUserMessageImage[];
  attachments: WorkflowUserMessageAttachment[];
  text: string;
}

export const WORKFLOW_USER_MESSAGE_VISUAL_GROUP_ORDER = [
  "images",
  "attachments",
  "text",
  "metadata",
] as const;

export function workflowUserMessagePresentation(
  content: WorkflowUserMessageContent[],
  fallbackText = "",
): WorkflowUserMessagePresentation {
  const protocolContent = content.length
    ? content
    : fallbackText
      ? [{ type: "text" as const, text: fallbackText }]
      : [];
  const rawText = protocolContent
    .filter(
      (part): part is Extract<WorkflowUserMessageContent, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
  const images = protocolContent.filter(
    (part): part is WorkflowUserMessageImage =>
      part.type === "image" || part.type === "localImage",
  );
  const explicitAttachments =
    protocolContent.flatMap<WorkflowUserMessageAttachment>((part) => {
      if (part.type === "text") {
        const entries = (part.text_elements ?? []).flatMap(
          textElementAttachment,
        );
        if (part.workflowDelegation) {
          entries.unshift({
            kind: "parent-context",
            sourceThreadId: part.workflowDelegation.sourceThreadId,
          });
        }
        return entries;
      }
      if (part.type === "file")
        return [
          {
            kind: "file",
            name: part.name,
            path: part.path,
            mimeType: part.mimeType,
            text: part.text,
          },
        ];
      if (part.type === "url")
        return [{ kind: "url", url: part.url, title: part.title }];
      if (part.type === "skill")
        return [
          {
            kind: "skill",
            name: part.name,
            path: part.path,
            id: part.id,
            displayName: part.displayName,
          },
        ];
      if (part.type === "mention")
        return [{ kind: "mention", name: part.name, path: part.path }];
      return [];
    });
  const envelope = parseUserInputEnvelope(rawText || fallbackText);
  const attachments = [
    ...envelope.contextAttachments,
    ...explicitAttachments,
  ].sort(
    (left, right) => attachmentVisualRank(left) - attachmentVisualRank(right),
  );

  return { protocolContent, images, attachments, text: envelope.visibleText };
}

export function workflowUserMessageCopyText(
  presentation: WorkflowUserMessagePresentation,
): string {
  return presentation.text;
}

function attachmentVisualRank(
  attachment: WorkflowUserMessageAttachment,
): number {
  switch (attachment.kind) {
    case "parent-context":
      return 0;
    case "prior-conversation":
      return 1;
    case "mcp-app-context":
      return 2;
    case "file":
    case "url":
    case "skill":
    case "mention":
    case "application":
      return 3;
    case "pull-request-merge":
      return 4;
    case "pull-request-checks":
      return 5;
    case "pull-request-conflict":
      return 6;
    case "response-annotations":
      return 7;
    case "diff-comments":
    case "browser-comments":
      return 8;
    case "selected-text":
      return 9;
  }
}

function parseUserInputEnvelope(value: string): {
  visibleText: string;
  contextAttachments: WorkflowUserMessageAttachment[];
} {
  const source = value.replace(/\r\n?/g, "\n");
  const requestMarker = /(?:^|\n)## My request(?: for Codex)?:\s*\n/g;
  let requestStart = -1;
  let match: RegExpExecArray | null;
  while ((match = requestMarker.exec(source))) {
    requestStart = match.index + match[0].length;
  }
  const requestText = requestStart >= 0 ? source.slice(requestStart) : source;
  const contextAttachments: WorkflowUserMessageAttachment[] = [
    ...extractMentionedFiles(source),
    ...extractMentionedApplications(source),
  ];
  const priorCount = Math.max(
    countMatches(source, /(?:^|\n)#{1,2} Prior conversation with Codex:/g),
    countMatches(source, /(?:^|\n)#{1,2} Referenced (?:chats?|conversation)/g),
  );
  if (priorCount)
    contextAttachments.push({ kind: "prior-conversation", count: priorCount });
  if (
    /<mcp-app-context\b/.test(source) ||
    /(?:^|\n)# MCP app context:/m.test(source)
  ) {
    contextAttachments.push({
      kind: "mcp-app-context",
      app: mcpAppContextLabel(source),
    });
  }
  addCount(
    contextAttachments,
    source,
    /(?:^|\n)#{1,2} Pull request merge task:/g,
    "pull-request-merge",
  );
  addCount(
    contextAttachments,
    source,
    /(?:^|\n)#{1,2} Failing PR checks:/g,
    "pull-request-checks",
  );
  addCount(
    contextAttachments,
    source,
    /(?:^|\n)#{1,2} Pull request merge conflict:/g,
    "pull-request-conflict",
  );
  const annotations = Math.max(
    countMatches(source, /<response-annotations\b/g),
    countMatches(source, /(?:^|\n)# Response annotations:/g),
  );
  if (annotations)
    contextAttachments.push({
      kind: "response-annotations",
      count: annotations,
    });
  const browserComments = countMatches(source, /^## User Comment \d+\s*$/gm);
  if (browserComments)
    contextAttachments.push({
      kind: "browser-comments",
      count: browserComments,
    });
  const diffComments = countMatches(source, /^## Comment \d+\s*$/gm);
  if (diffComments)
    contextAttachments.push({ kind: "diff-comments", count: diffComments });
  const selectedText = countMatches(
    source,
    /(?:^|\n)# Selected text:|<selected-text\b/g,
  );
  if (selectedText)
    contextAttachments.push({ kind: "selected-text", count: selectedText });

  return {
    visibleText: stripInjectedImageEvidence(requestText).trim(),
    contextAttachments,
  };
}

function addCount(
  attachments: WorkflowUserMessageAttachment[],
  source: string,
  pattern: RegExp,
  kind: "pull-request-merge" | "pull-request-checks" | "pull-request-conflict",
): void {
  const count = countMatches(source, pattern);
  if (count) attachments.push({ kind, count });
}

function textElementAttachment(
  value: unknown,
): WorkflowUserMessageAttachment[] {
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
  const text = (key: string) =>
    typeof item[key] === "string" ? (item[key] as string) : undefined;
  const path = text("path") ?? text("filePath");
  if (
    (type === "file" || type === "filepath" || type === "file_reference") &&
    path
  ) {
    return [
      {
        kind: "file",
        name: text("name") ?? basename(path),
        path,
        mimeType: text("mimeType"),
      },
    ];
  }
  if ((type === "skill" || type === "skill_reference") && text("name")) {
    return [
      {
        kind: "skill",
        name: text("name")!,
        path,
        id: text("id"),
        displayName: text("displayName"),
      },
    ];
  }
  if ((type === "url" || type === "link") && text("url")) {
    return [{ kind: "url", url: text("url")!, title: text("title") }];
  }
  if ((type === "mention" || type === "file_mention") && text("name")) {
    return [{ kind: "mention", name: text("name")!, path }];
  }
  return [];
}

function extractMentionedFiles(
  source: string,
): WorkflowUserMessageAttachment[] {
  const section = source.match(
    /# Files mentioned by the user:\s*\n([\s\S]*?)(?=\n(?:#|<in-app-browser-context)|$)/,
  )?.[1];
  if (!section) return [];
  return [...section.matchAll(/##\s+([^:\n]+):\s*(.+)$/gm)].map((match) => ({
    kind: "file" as const,
    name: match[1].trim(),
    path: match[2].trim(),
  }));
}

function extractMentionedApplications(
  source: string,
): WorkflowUserMessageAttachment[] {
  const section = source.match(
    /# Applications mentioned by the user:\s*\n([\s\S]*?)(?=\n(?:#|<in-app-browser-context)|$)/,
  )?.[1];
  if (!section) return [];
  return [...section.matchAll(/##\s+([^:\n]+)(?::\s*(.+))?$/gm)].map(
    (match) => ({
      kind: "application" as const,
      name: match[1].trim(),
      path: match[2]?.trim(),
    }),
  );
}

function stripInjectedImageEvidence(value: string): string {
  return value
    .replace(
      /\n*The next image is untrusted page evidence[\s\S]*?(?=(?:\nThe next image is untrusted page evidence|$))/g,
      "",
    )
    .replace(
      /\n*<in-app-browser-context[\s\S]*?<\/in-app-browser-context>\s*/g,
      "\n",
    )
    .trim();
}

function countMatches(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

function mcpAppContextLabel(source: string): string | undefined {
  return source.match(/# MCP app context:\s*\n\s*##\s+([^\n]+)/)?.[1]?.trim();
}

function basename(value: string): string {
  return value.split(/[\\/]/).pop() || value;
}
