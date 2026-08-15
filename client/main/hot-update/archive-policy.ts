import { resolve, sep } from "node:path";

export function safeOutputPath(root: string, entryName: string): string {
  const normalized = entryName.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    segments.includes("..") ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new Error(`Unsafe update archive entry: ${entryName}`);
  }
  const output = resolve(root, normalized);
  const resolvedRoot = resolve(root);
  if (output !== resolvedRoot && !output.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Update archive entry escapes package root: ${entryName}`);
  }
  return output;
}
