/**
 * Builds SDK message content for the Claude agent SDK.
 *
 * For vision-capable models, image attachments are converted to base64
 * image blocks and sent alongside the text. For non-vision models, the
 * plain text string (with image metadata already baked in by the caller)
 * is returned as-is.
 */

export function parseDataUrl(
  value: string,
): { mediaType: string; data: string } | null {
  const match = value.match(/^data:([^;,]+);base64,(.+)$/is);
  if (!match) return null;
  return { mediaType: match[1].toLowerCase(), data: match[2] };
}

interface ParsedImage {
  mediaType: string;
  data: string;
}

function extractImage(attachment: unknown): ParsedImage | null {
  if (!attachment || typeof attachment !== "object") return null;
  const record = attachment as Record<string, unknown>;
  const dataUrl =
    typeof record.url === "string"
      ? record.url
      : typeof record.dataUrl === "string"
        ? record.dataUrl
        : "";
  if (!dataUrl) return null;
  const parsed = parseDataUrl(dataUrl);
  if (parsed) return parsed;
  return null;
}

export function buildSdkUserContent(
  text: string,
  attachments: unknown[] | undefined,
  supportsVision: boolean,
): string | Array<Record<string, unknown>> {
  const images = (attachments ?? [])
    .map(extractImage)
    .filter((img): img is ParsedImage => img !== null);

  if (!supportsVision || images.length === 0) {
    return text;
  }

  const content: Array<Record<string, unknown>> = [];
  if (text.trim()) {
    content.push({ type: "text", text });
  }
  for (const img of images) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType,
        data: img.data,
      },
    });
  }
  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }
  return content;
}
