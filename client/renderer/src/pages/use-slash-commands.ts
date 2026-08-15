/**
 * useSlashCommands — merges runtime-reported skills, UI-side builtin
 * commands, and SDK slash commands into a single list for the composer
 * slash menu.
 */

import { useState, useEffect, useMemo } from "react";
import type { SlashCommandItem } from "../types";
import type { SessionInitInfo } from "@/stores/unified-chat-store";
import type { SkillInfo } from "@shared/types";

// Local UI-side commands always available (runtime doesn't report these).
// Hoisted to module scope so the array is stable across renders.
const UI_BUILTIN_COMMANDS: SlashCommandItem[] = [
  {
    id: "ui-compact",
    command: "/compact",
    label: "压缩上下文",
    category: "builtin",
  },
];

export interface ComposerCatalogs {
  slashCommands: SlashCommandItem[];
  skills: SkillInfo[];
}

export function useComposerCatalogs(
  sessionInitInfo: SessionInitInfo | undefined,
): ComposerCatalogs {
  // Fetch installed skills from the skill-service so the / menu is populated
  // immediately on app start — without waiting for the first SDK init event.
  const [installedSkills, setInstalledSkills] = useState<SkillInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    window.marloues.skill
      .list()
      .then((skills) => {
        if (!cancelled)
          setInstalledSkills(skills.filter((skill) => skill.enabled));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const slashCommands = useMemo<SlashCommandItem[]>(() => {
    const init = sessionInitInfo;
    const runtimeSkills = new Set(init?.skills ?? []);
    // Merge skill-service names (available immediately, no SDK round-trip)
    // with runtime-reported skills so the / menu is never empty on app start.
    const skills = Array.from(
      new Set([
        ...runtimeSkills,
        ...installedSkills.map((skill) => skill.name),
      ]),
    );
    const sdkCommands = init?.slashCommands ?? [];
    const items: SlashCommandItem[] = [];
    // (a) Skills discovered by the runtime — category 'skill'
    for (const name of skills) {
      items.push({
        id: `skill-${name}`,
        command: `/${name}`,
        label: name,
        category: "skill",
      });
    }
    // (b) Builtin commands — UI-side commands always present, plus curated
    // runtime commands (only `compact` exposed from the SDK list).
    const uiCommandsByName = new Map(
      UI_BUILTIN_COMMANDS.map((c) => [c.command.slice(1), c]),
    );
    const seen = new Set<string>();
    const ALLOWED_BUILTIN_COMMANDS = new Set(["compact"]);
    for (const name of sdkCommands) {
      if (!ALLOWED_BUILTIN_COMMANDS.has(name)) continue;
      if (skills.includes(name)) continue;
      if (uiCommandsByName.has(name)) {
        items.push(uiCommandsByName.get(name)!);
        seen.add(name);
      } else {
        items.push({
          id: `builtin-${name}`,
          command: `/${name}`,
          label: name,
          category: "builtin",
        });
        seen.add(name);
      }
    }
    // Append UI-side builtins not already added from runtime
    for (const cmd of UI_BUILTIN_COMMANDS) {
      const name = cmd.command.slice(1);
      if (!seen.has(name) && !skills.includes(name)) {
        items.push(cmd);
      }
    }
    return items;
  }, [sessionInitInfo, installedSkills]);

  return { slashCommands, skills: installedSkills };
}

export function useSlashCommands(
  sessionInitInfo: SessionInitInfo | undefined,
): SlashCommandItem[] {
  return useComposerCatalogs(sessionInitInfo).slashCommands;
}
