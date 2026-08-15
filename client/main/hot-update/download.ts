import { net } from "electron";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { dirname } from "node:path";

const MAX_MANIFEST_BYTES = 1024 * 1024;

export async function fetchBytes(
  url: string,
  maxBytes = MAX_MANIFEST_BYTES,
): Promise<Buffer> {
  const response = await net.fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes)
    throw new Error(`Update response is too large: ${url}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Update response has no body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error(`Update response is too large: ${url}`);
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks, length);
}

function totalFromResponse(response: Response, offset: number): number {
  const contentRange = response.headers.get("content-range");
  const totalMatch = contentRange?.match(/\/(\d+)$/);
  if (totalMatch) return Number(totalMatch[1]);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  return response.status === 206 ? offset + contentLength : contentLength;
}

export async function downloadToFile(input: {
  url: string;
  destination: string;
  expectedSize: number;
  signal?: AbortSignal;
  onProgress?: (transferred: number, total: number) => void;
}): Promise<void> {
  await mkdir(dirname(input.destination), { recursive: true });
  let offset = existsSync(input.destination)
    ? (await stat(input.destination)).size
    : 0;
  if (offset > input.expectedSize) offset = 0;
  if (offset === input.expectedSize) {
    input.onProgress?.(offset, input.expectedSize);
    return;
  }

  const headers = new Headers();
  if (offset > 0) headers.set("Range", `bytes=${offset}-`);
  let response = await net.fetch(input.url, {
    headers,
    signal: input.signal,
    cache: "no-store",
  });
  if (response.status === 416 && offset > 0) {
    offset = 0;
    response = await net.fetch(input.url, {
      signal: input.signal,
      cache: "no-store",
    });
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${input.url}`);

  const append = response.status === 206 && offset > 0;
  if (!append) offset = 0;
  const total = totalFromResponse(response, offset) || input.expectedSize;
  if (total !== input.expectedSize) {
    throw new Error(
      `Update size mismatch: expected ${input.expectedSize}, received ${total}`,
    );
  }
  const file = await open(input.destination, append ? "a" : "w");
  let transferred = offset;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Update response has no body");
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      transferred += chunk.value.byteLength;
      if (transferred > input.expectedSize) {
        await reader.cancel();
        throw new Error("Update response exceeded its declared size");
      }
      await file.write(chunk.value);
      input.onProgress?.(transferred, total);
    }
  } finally {
    await file.close();
  }
  if (transferred !== input.expectedSize) {
    throw new Error(
      `Update size mismatch: expected ${input.expectedSize}, received ${transferred}`,
    );
  }
}

export async function sha512File(filePath: string): Promise<string> {
  const hash = createHash("sha512");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("base64");
}
