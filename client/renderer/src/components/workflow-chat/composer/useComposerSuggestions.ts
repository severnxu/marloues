import { useCallback, useEffect, useMemo, useState } from "react";
import type { SkillInfo } from "@shared/types";
import {
  mentionAttachment,
  type ComposerAttachment,
} from "./composer-attachments";
import {
  MAX_WORKSPACE_MENTIONS,
  MAX_WORKSPACE_MENTION_DEPTH,
  composerSuggestionQuery,
  selectedSkillAttachment,
  type ComposerSuggestionQuery,
} from "./composer-contract";
import type { ComposerSuggestion } from "./ComposerSuggestionPopover";

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".cache",
]);

export function useComposerSuggestions({
  input,
  caret,
  skills,
}: {
  input: string;
  caret: number;
  skills: SkillInfo[];
}) {
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const query = useMemo(
    () => composerSuggestionQuery(input, caret),
    [caret, input],
  );

  useEffect(() => {
    if (query?.kind !== "mention" || workspaceFiles.length) return;
    let cancelled = false;
    void listWorkspaceFiles().then((files) => {
      if (!cancelled) setWorkspaceFiles(files);
    });
    return () => {
      cancelled = true;
    };
  }, [query?.kind, workspaceFiles.length]);

  const items = useMemo<ComposerSuggestion[]>(() => {
    if (!query || query.kind === "command") return [];
    const normalized = query.query.toLocaleLowerCase();
    if (query.kind === "skill") {
      return skills
        .filter((skill) => skill.enabled && skill.path)
        .filter((skill) =>
          `${skill.name} ${skill.description ?? ""}`
            .toLocaleLowerCase()
            .includes(normalized),
        )
        .slice(0, 12)
        .map((skill) => ({
          kind: "skill",
          id: skill.id,
          label: skill.name,
          detail: skill.description,
          skill,
        }));
    }
    return workspaceFiles
      .filter((path) => path.toLocaleLowerCase().includes(normalized))
      .slice(0, 16)
      .map((path) => ({
        kind: "mention",
        id: path,
        label: basename(path),
        detail: path,
        path,
      }));
  }, [query, skills, workspaceFiles]);

  const attachmentFor = useCallback(
    (suggestion: ComposerSuggestion): ComposerAttachment => {
      return suggestion.kind === "skill"
        ? selectedSkillAttachment(suggestion.skill)
        : mentionAttachment(suggestion.label, suggestion.path);
    },
    [],
  );

  return { query, items, attachmentFor };
}

async function listWorkspaceFiles(): Promise<string[]> {
  const files: string[] = [];
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (
      depth > MAX_WORKSPACE_MENTION_DEPTH ||
      files.length >= MAX_WORKSPACE_MENTIONS
    )
      return;
    let entries: Awaited<ReturnType<typeof window.marloues.fs.listDir>>;
    try {
      entries = await window.marloues.fs.listDir(dir || ".");
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_WORKSPACE_MENTIONS) return;
      const path = dir && dir !== "." ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        if (!IGNORED_DIRS.has(entry.name)) await visit(path, depth + 1);
      } else {
        files.push(path);
      }
    }
  };
  await visit(".", 0);
  return files;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export type { ComposerSuggestionQuery };
