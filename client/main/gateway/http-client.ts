// ============================================================
// HTTP Client — forwards requests to upstream providers
// ============================================================

import http from "http";
import https from "https";
import type { IncomingMessage } from "http";
import { logHttp } from "../core/logging/app-logger";

export interface ForwardOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  timeout?: number;
  adapterId?: string;
}

export interface ForwardResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Forward a non-streaming request and return the full response */
export async function forwardRequest(
  opts: ForwardOptions,
): Promise<ForwardResult> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(opts.url);
    const isHttps = parsedUrl.protocol === "https:";
    const lib = isHttps ? https : http;

    const req = lib.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: opts.method,
        headers: opts.headers,
        timeout: opts.timeout ?? 120_000,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          const respHeaders: Record<string, string> = {};
          for (const [key, val] of Object.entries(res.headers)) {
            if (val)
              respHeaders[key] = Array.isArray(val) ? val.join(", ") : val;
          }
          resolve({
            status: res.statusCode ?? 500,
            headers: respHeaders,
            body,
          });
          logHttp("http-client.response", {
            status: res.statusCode,
            bodyLen: body.length,
            bodyPreview: body.slice(0, 200),
          });
        });
        res.on("error", reject);
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Request timeout"));
    });

    req.write(opts.body);
    req.end();
    logHttp("http-client.request", {
      method: opts.method,
      url: opts.url,
      bodyPreview: opts.body.slice(0, 200),
    });
  });
}

/** Forward a streaming request and return a readable response stream */
export function forwardStreamRequest(
  opts: ForwardOptions,
): Promise<{
  status: number;
  headers: Record<string, string>;
  stream: IncomingMessage;
}> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(opts.url);
    const isHttps = parsedUrl.protocol === "https:";
    const lib = isHttps ? https : http;

    const req = lib.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: opts.method,
        headers: opts.headers,
        timeout: opts.timeout ?? 300_000,
      },
      (res: IncomingMessage) => {
        const respHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(res.headers)) {
          if (val) respHeaders[key] = Array.isArray(val) ? val.join(", ") : val;
        }
        resolve({
          status: res.statusCode ?? 500,
          headers: respHeaders,
          stream: res,
        });
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Stream request timeout"));
    });

    req.write(opts.body);
    req.end();
  });
}
