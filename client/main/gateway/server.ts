/**
 * HTTP Server - listens for API requests
 */

import http from "http";
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { handleRequest } from "./pipeline";
import { detectProtocol } from "./protocol";
import { log } from "./logger";

export interface RouteDecision {
  targetProvider: string;
  targetModel: string;
  targetProtocol: "anthropic" | "openai-chat" | "openai-responses";
  targetBaseUrl: string;
  apiKey: string;
  adapterId?: string;
}

export type RouteResolver = (
  sourceProtocol: "anthropic" | "openai-chat" | "openai-responses",
  model: string,
) => RouteDecision[];

export interface ServerConfig {
  port: number;
  internalToken: string;
  resolveRoute: RouteResolver;
  getModels: () => string[];
}

let server: http.Server | null = null;

export function createServer(config: ServerConfig): http.Server {
  const srv = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.headers.origin || !isAuthorized(req, config.internalToken)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Forbidden" } }));
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? "";

    if (url === "/health" || url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          proxy: "neo-runtime-gateway",
          version: "0.1.0",
        }),
      );
      return;
    }

    if (url === "/v1/models" || url.startsWith("/v1/models?")) {
      const modelIds = config.getModels();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: modelIds.map((id) => ({
            id,
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: "neo-runtime-gateway",
          })),
        }),
      );
      return;
    }

    if (req.method === "POST" && detectProtocol(url)) {
      log(`[Gateway] POST matched, calling handleRequest for ${url}`);
      handleRequest(req, res)
        .then(() => {
          log(`[Gateway] handleRequest completed for ${url}`);
        })
        .catch((err) => {
          log(`[Gateway] handleRequest error for ${url}:`, err);
        });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: { message: "Not found", type: "not_found" } }),
    );
  });

  return srv;
}

export function startServer(config: ServerConfig): Promise<number> {
  return new Promise((resolve, reject) => {
    server = createServer(config);
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", () => {
      const addr = server?.address();
      const actualPort =
        typeof addr === "object" && addr !== null ? addr.port : config.port;
      log(`[Gateway] Server listening on port ${actualPort}`);
      resolve(actualPort);
    });
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.closeIdleConnections?.();
      server.close(() => {
        log("[Gateway] Server stopped");
        server = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

function isAuthorized(req: IncomingMessage, expectedToken: string): boolean {
  const header = firstHeader(req.headers.authorization);
  const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  const provided =
    bearer ??
    firstHeader(req.headers["x-api-key"]) ??
    firstHeader(req.headers["api-key"]);
  if (!provided) return false;
  const expected = Buffer.from(expectedToken);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
