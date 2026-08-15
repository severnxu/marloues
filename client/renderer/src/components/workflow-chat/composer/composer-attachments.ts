/**
 * Composer attachment helpers — shared by the input composer and tests.
 *
 * Supports two attachment kinds:
 *  - image: raster image read as a data URL (existing behaviour).
 *  - file:  text-based file (code, markdown, JSON, CSV, config, logs, ...)
 *           read as UTF-8 text and injected into the prompt as a labelled
 *           fenced block. Binary formats (PDF/Office) are rejected here with
 *           a clear notification; they can be added later via extraction.
 */
import type { UserMessageContent } from "../../../types";
import type { SkillInfo } from "@shared/types";
import { composerAttachmentsToContent } from "./composer-contract";

export type ComposerAttachment =
  | {
      kind: "image";
      id: string;
      name: string;
      mimeType: string;
      dataUrl: string;
      size: number;
    }
  | {
      kind: "file";
      id: string;
      name: string;
      mimeType: string;
      text: string;
      size: number;
    }
  | {
      kind: "url";
      id: string;
      url: string;
    }
  | {
      kind: "skill";
      id: string;
      skill: SkillInfo;
      /** Compatibility fields for older composer consumers. */
      name: string;
      command: string;
      path?: string;
    }
  | {
      kind: "mention";
      id: string;
      name: string;
      path: string;
    };
export const MAX_ATTACHMENTS = 6;
export const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_ATTACHMENT_BYTES = 256 * 1024;

/** MIME types that are text-readable but don't start with "text/". */
const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/x-sh",
  "application/typescript",
]);

/** Extensions accepted as text when the OS reports no usable MIME type. */
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".json5",
  ".jsonc",
  ".md",
  ".mdx",
  ".markdown",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".stylus",
  ".html",
  ".htm",
  ".xml",
  ".svg",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".properties",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".bat",
  ".cmd",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".cxx",
  ".cs",
  ".php",
  ".sql",
  ".graphql",
  ".gql",
  ".proto",
  ".thrift",
  ".env",
  ".example",
  ".txt",
  ".log",
  ".csv",
  ".tsv",
  ".vue",
  ".svelte",
  ".astro",
  ".dockerfile",
  ".editorconfig",
  ".gitignore",
  ".gitattributes",
  ".eslintrc",
  ".prettierrc",
  ".babelrc",
  ".npmrc",
]);

/** Extensionless filenames treated as text. */
const TEXT_FILENAMES = new Set([
  "dockerfile",
  "makefile",
  "rakefile",
  "gemfile",
  "procfile",
  ".env",
  ".gitignore",
  ".npmrc",
  ".editorconfig",
]);

function fileExtension(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot < 0 ? "" : lower.slice(dot);
}

function fileBaseName(name: string): string {
  return name.toLowerCase().split(/[\\/]/).pop() ?? name.toLowerCase();
}

/**
 * Whether a file can be attached as readable text. Images are excluded
 * (they take the image path). Unknown binary formats return false so the
 * caller can notify the user instead of silently dropping them.
 */
export function isTextFile(file: File): boolean {
  if (file.type.startsWith("image/")) return false;
  const type = file.type.toLowerCase();
  if (type.startsWith("text/")) return true;
  if (TEXT_MIME_TYPES.has(type)) return true;
  // Many OSes report "" or "application/octet-stream" for code files.
  if (TEXT_EXTENSIONS.has(fileExtension(file.name))) return true;
  return TEXT_FILENAMES.has(fileBaseName(file.name));
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unable to read file as text"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Unable to read file"));
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unable to read image"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Unable to read image"));
    reader.readAsDataURL(file);
  });
}

export async function fileToImageAttachment(
  file: File,
): Promise<ComposerAttachment> {
  return {
    kind: "image",
    id: crypto.randomUUID(),
    name: file.name || "clipboard-image",
    mimeType: file.type || "image/png",
    dataUrl: await readFileAsDataUrl(file),
    size: file.size,
  };
}

export async function fileToFileAttachment(
  file: File,
): Promise<ComposerAttachment> {
  return {
    kind: "file",
    id: crypto.randomUUID(),
    name: file.name || "untitled.txt",
    mimeType: file.type || "text/plain",
    text: await readFileAsText(file),
    size: file.size,
  };
}

/** Build the <input type=file accept=...> value from image + text extensions. */
export const FILE_ACCEPT: string = ["image/*", ...TEXT_EXTENSIONS].join(",");

/** Quick check for http(s) URLs. */
export function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}
export function urlAttachment(url: string): ComposerAttachment {
  return { kind: "url", id: crypto.randomUUID(), url: url.trim() };
}

/** Create a skill attachment from a slash-command selection. */
export function skillAttachment(
  name: string,
  command: string,
  path?: string,
): ComposerAttachment {
  return {
    kind: "skill",
    id: crypto.randomUUID(),
    skill: {
      id: path || command || name,
      name,
      path: path ?? "",
      scope: "user",
      enabled: Boolean(path),
    },
    name,
    command,
    path,
  };
}
export function mentionAttachment(
  name: string,
  path: string,
): ComposerAttachment {
  return { kind: "mention", id: crypto.randomUUID(), name, path };
}
/** Convert composer attachments to the wire content sent to the store. */
export function attachmentsToUserContent(
  attachments: ComposerAttachment[],
): UserMessageContent[] {
  return composerAttachmentsToContent(attachments);
}
