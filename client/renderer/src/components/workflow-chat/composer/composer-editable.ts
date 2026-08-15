/**
 * Helpers for managing a contentEditable div that mixes inline skill
 * chips (non-editable spans) with editable text. The editable serves
 * as the composer's text input, replacing <textarea> so chips can flow
 * inline with the text rather than sitting in a separate column.
 */

/** Minimal data needed to build a chip element. */
export interface SkillChipData {
  id: string;
  name: string;
}

const WRENCH_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';

const X_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

/** Build a non-editable chip <span> for use inside the contentEditable. */
export function buildChipElement(att: SkillChipData): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = "composer-skill-token";
  chip.setAttribute("contenteditable", "false");
  chip.setAttribute("data-skill-chip", "");
  chip.setAttribute("data-skill-id", att.id);

  const icon = document.createElement("span");
  icon.className = "composer-skill-token-icon";
  icon.innerHTML = WRENCH_SVG;
  chip.appendChild(icon);

  const name = document.createElement("span");
  name.className = "composer-skill-token-name";
  name.textContent = att.name;
  chip.appendChild(name);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "composer-skill-token-remove";
  remove.setAttribute("data-skill-remove", "");
  remove.setAttribute("aria-label", "移除技能");
  remove.setAttribute("title", "移除技能");
  remove.innerHTML = X_SVG;
  chip.appendChild(remove);

  return chip;
}

/**
 * Extract editable text from the contentEditable, skipping chip
 * elements. Converts <br> and block boundaries to "\n".
 */
export function extractText(el: HTMLElement): string {
  let text = "";
  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = (node as Text).parentElement;
      if (parent?.closest("[data-skill-chip]")) return;
      text += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const e = node as Element;
    if (e.hasAttribute("data-skill-chip")) return;
    if (e.tagName === "BR") {
      text += "\n";
      return;
    }
    if (
      (e.tagName === "DIV" || e.tagName === "P") &&
      text.length > 0 &&
      !text.endsWith("\n")
    ) {
      text += "\n";
    }
    for (const child of Array.from(e.childNodes)) {
      walk(child);
    }
  }
  walk(el);
  return text;
}

/**
 * Replace all non-chip content in the editable with the given text,
 * preserving existing chip elements. Uses a single text node so that
 * white-space: pre-wrap renders "\n" as line breaks.
 */
export function setTextInEditable(el: HTMLElement, text: string): void {
  const toRemove: ChildNode[] = [];
  for (const child of Array.from(el.childNodes)) {
    if (
      child.nodeType === Node.ELEMENT_NODE &&
      (child as Element).hasAttribute("data-skill-chip")
    ) {
      continue;
    }
    toRemove.push(child);
  }
  for (const node of toRemove) {
    node.remove();
  }
  if (text) {
    el.appendChild(document.createTextNode(text));
  }
}

/** Move the caret to the end of all content in the editable. */
export function placeCursorAtEnd(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/**
 * Reconcile chip elements in the DOM with the skills array.
 * Adds missing chips (at the beginning, before any text) and removes
 * stale ones — without touching the editable text in between.
 */
export function syncChips(el: HTMLElement, skills: SkillChipData[]): void {
  const domChips = Array.from(
    el.querySelectorAll("[data-skill-chip]"),
  ) as HTMLElement[];
  const domIds = new Set(
    domChips.map((c) => c.getAttribute("data-skill-id") ?? ""),
  );
  const stateIds = new Set(skills.map((s) => s.id));

  // Remove chips no longer present in state
  for (const chip of domChips) {
    const id = chip.getAttribute("data-skill-id") ?? "";
    if (!stateIds.has(id)) {
      const next = chip.nextSibling;
      if (
        next &&
        next.nodeType === Node.TEXT_NODE &&
        next.textContent === "\u00A0"
      ) {
        next.remove();
      }
      chip.remove();
    }
  }

  // Add chips present in state but not yet in DOM
  for (const att of skills) {
    if (domIds.has(att.id)) continue;
    const chip = buildChipElement(att);
    const space = document.createTextNode("\u00A0");
    // Find insertion point: after the last chip+space, before text
    const existing = Array.from(
      el.querySelectorAll("[data-skill-chip]"),
    ) as HTMLElement[];
    let insertBefore: Node | null;
    if (existing.length > 0) {
      const last = existing[existing.length - 1];
      const after = last.nextSibling;
      if (
        after &&
        after.nodeType === Node.TEXT_NODE &&
        after.textContent === "\u00A0"
      ) {
        insertBefore = after.nextSibling;
      } else {
        insertBefore = after;
      }
    } else {
      insertBefore = el.firstChild;
    }
    if (insertBefore) {
      el.insertBefore(space, insertBefore);
      el.insertBefore(chip, space);
    } else {
      el.appendChild(chip);
      el.appendChild(space);
    }
  }
}

/** Auto-resize the editable to fit content, clamped to min/max height. */
export function autoResize(el: HTMLElement, min: number, max: number): void {
  el.style.height = "0px";
  el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`;
}

/** Insert plain text at the current caret position in the editable. */
export function insertTextAtCaret(el: HTMLElement, text: string): void {
  el.focus();
  // execCommand is deprecated but still the most reliable way to insert
  // plain text at the caret in a contentEditable in Chromium (Electron).
  document.execCommand("insertText", false, text);
}
