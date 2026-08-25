/**
 * Request Processing Pipeline
 *
 * detect -> decode -> route -> encode -> forward -> [parse/stream] -> [format/stream] -> reply
 */

import type { IncomingMessage, ServerResponse } from "http";
import { randomUUID } from "crypto";
import {
  detectProtocol,
  decodeRequest,
  encodeRequest,
  parseResponse,
  formatResponse,
  needsConversion,
  type ProtocolId,
  type IrRequest,
} from "./protocol";

import {
  AnthropicSseParser,
  OpenAIChatSseParser,
  OpenAIResponsesSseParser,
  AnthropicSseFormatter,
  OpenAIChatSseFormatter,
  OpenAIResponsesSseFormatter,
} from "./protocol/stream";

import { forwardRequest, forwardStreamRequest } from "./http-client";
import { log } from "./logger";
import { logHttp, isDeveloperMode } from "../core/logging/app-logger";

export interface RouteDecision {
  targetProvider: string;
  targetModel: string;
  targetProtocol: ProtocolId;
  targetBaseUrl: string;
  apiKey: string;
  adapterId?: string;
}

export type RouteResolver = (
  sourceProtocol: ProtocolId,
  model: string,
) => RouteDecision[];

export interface PipelineConfig {
  resolveRoute: RouteResolver;
}

let pipelineConfig: PipelineConfig | null = null;

export function configurePipeline(config: PipelineConfig): void {
  pipelineConfig = config;
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const requestId = randomUUID();
  const startTime = Date.now();

  try {
    const url = req.url ?? "";
    const sourceProtocol = detectProtocol(url);

    if (!sourceProtocol) {
      log(`[Pipeline] Unknown protocol for URL: ${url}`);
      sendError(res, 400, "Unsupported API path");
      return;
    }

    log(`[Pipeline] ${req.method} ${url} -> ${sourceProtocol}`);

    const body = await readBody(req);
    logHttp("pipeline.rawBody", { preview: body.slice(0, 500) });
    const rawBody = JSON.parse(body);

    const irRequest = decodeRequest(sourceProtocol, rawBody, requestId);
    log(`[Pipeline] model=${irRequest.model}, stream=${irRequest.stream}`);

    if (!pipelineConfig) {
      sendError(res, 503, "Pipeline not configured");
      return;
    }

    const routes = pipelineConfig.resolveRoute(sourceProtocol, irRequest.model);
    if (routes.length === 0) {
      sendError(res, 502, `No route found for model: ${irRequest.model}`);
      return;
    }

    if (irRequest.stream) {
      await handleStreamRequest(
        req,
        res,
        irRequest,
        routes,
        sourceProtocol,
        startTime,
      );
    } else {
      await handleNonStreamRequest(
        req,
        res,
        irRequest,
        routes,
        sourceProtocol,
        startTime,
      );
    }
  } catch (err) {
    log(`[Pipeline] Error:`, err);
    if (!res.headersSent) {
      sendError(res, 500, "Internal proxy error");
    }
  }
}

async function handleNonStreamRequest(
  req: IncomingMessage,
  res: ServerResponse,
  irRequest: IrRequest,
  routes: RouteDecision[],
  sourceProtocol: ProtocolId,
  startTime: number,
): Promise<void> {
  let lastStatus = 502;

  for (const route of routes) {
    const result = await tryNonStreamRequest(
      irRequest,
      route,
      sourceProtocol,
      startTime,
    );
    if (result.ok || result.status < 500) {
      if (result.ok && result.response) {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify(result.response));
        return;
      }
      log(
        `[Pipeline] Non-stream: ok=${result.ok} status=${result.status} but no response body`,
      );
      sendError(
        res,
        result.status || 502,
        "Provider returned no parseable response",
      );
      return;
    }
    lastStatus = result.status;
  }

  sendError(res, lastStatus, "All providers failed");
}

async function tryNonStreamRequest(
  irRequest: IrRequest,
  route: RouteDecision,
  sourceProtocol: ProtocolId,
  _startTime: number,
): Promise<{ ok: boolean; status: number; response?: unknown }> {
  const { body, headers, path } = encodeRequest(
    route.targetProtocol,
    irRequest,
  );

  if (irRequest.model !== route.targetModel) {
    (body as { model: string }).model = route.targetModel;
  }

  let baseUrl = route.targetBaseUrl.replace(/\/+$/, "");
  if (baseUrl.endsWith("/v1")) {
    baseUrl = baseUrl.slice(0, -3);
  }
  const url = `${baseUrl}${path}`;

  if (route.targetProtocol === "anthropic") {
    headers["x-api-key"] = route.apiKey;
  } else {
    headers["Authorization"] = `Bearer ${route.apiKey}`;
  }

  const upstream = await forwardRequest({
    url,
    method: "POST",
    headers,
    body: JSON.stringify(body),
    adapterId: route.adapterId,
  });

  if (upstream.status >= 500) {
    return { ok: false, status: upstream.status };
  }

  if (upstream.status >= 400) {
    return { ok: true, status: upstream.status };
  }

  try {
    const upstreamResponse = JSON.parse(upstream.body);
    const irResponse = parseResponse(
      route.targetProtocol,
      upstreamResponse,
      irRequest.meta.requestId,
      irRequest.meta.originalModel,
    );

    const clientResponse = formatResponse(sourceProtocol, irResponse);
    return { ok: true, status: upstream.status, response: clientResponse };
  } catch (err) {
    log(`[Pipeline] Failed to parse response:`, err);
    return { ok: true, status: upstream.status };
  }
}

async function handleStreamRequest(
  req: IncomingMessage,
  res: ServerResponse,
  irRequest: IrRequest,
  routes: RouteDecision[],
  sourceProtocol: ProtocolId,
  startTime: number,
): Promise<void> {
  let lastStatus = 502;

  for (const route of routes) {
    const result = await tryStreamRequest(
      irRequest,
      route,
      sourceProtocol,
      res,
      startTime,
    );
    if (result.ok || result.status < 500) {
      return;
    }
    lastStatus = result.status;
  }

  sendError(res, lastStatus, "All providers failed");
}

async function tryStreamRequest(
  irRequest: IrRequest,
  route: RouteDecision,
  sourceProtocol: ProtocolId,
  res: ServerResponse,
  startTime: number,
): Promise<{ ok: boolean; status: number }> {
  const { body, headers, path } = encodeRequest(
    route.targetProtocol,
    irRequest,
  );

  if (irRequest.model !== route.targetModel) {
    (body as { model: string }).model = route.targetModel;
  }

  let baseUrl = route.targetBaseUrl.replace(/\/+$/, "");
  if (baseUrl.endsWith("/v1")) {
    baseUrl = baseUrl.slice(0, -3);
  }
  const url = `${baseUrl}${path}`;

  if (route.targetProtocol === "anthropic") {
    headers["x-api-key"] = route.apiKey;
  } else {
    headers["Authorization"] = `Bearer ${route.apiKey}`;
  }

  const upstream = await forwardStreamRequest({
    url,
    method: "POST",
    headers,
    body: JSON.stringify(body),
    adapterId: route.adapterId,
  });

  if (upstream.status >= 500) {
    await drainStream(upstream.stream);
    return { ok: false, status: upstream.status };
  }

  if (upstream.status >= 400) {
    res.writeHead(upstream.status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    const chunks: Buffer[] = [];
    upstream.stream.on("data", (c: Buffer) => chunks.push(c));
    await new Promise<void>((resolve) => {
      upstream.stream.on("end", () => {
        res.end(Buffer.concat(chunks));
        resolve();
      });
    });
    return { ok: true, status: upstream.status };
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const needConv = needsConversion(sourceProtocol, route.targetProtocol);

  if (!needConv) {
    await relayStream(upstream.stream, res, route, startTime);
    return { ok: true, status: 200 };
  }

  await convertStream(
    upstream.stream,
    res,
    route.targetProtocol,
    sourceProtocol,
    irRequest,
    startTime,
  );

  return { ok: true, status: 200 };
}

async function relayStream(
  stream: IncomingMessage,
  res: ServerResponse,
  route: RouteDecision,
  _startTime: number,
): Promise<void> {
  return new Promise((resolve) => {
    stream.on("data", (chunk: Buffer) => {
      let line = chunk.toString();
      if (line.indexOf("data: ") === 0) {
        try {
          const dataStr = line.slice(6).trim();
          if (dataStr !== "[DONE]") {
            const parsed = JSON.parse(dataStr);
            if (parsed.model) {
              parsed.model = route.targetModel;
            }
            line = `data: ${JSON.stringify(parsed)}\n\n`;
          }
        } catch {
          // Not JSON, send as-is
        }
      }
      res.write(line);
    });

    stream.on("end", () => {
      res.end();
      resolve();
    });

    stream.on("error", (err) => {
      log("[Pipeline] Stream error:", err);
      res.end();
      resolve();
    });
  });
}

async function convertStream(
  stream: IncomingMessage,
  res: ServerResponse,
  providerProtocol: ProtocolId,
  clientProtocol: ProtocolId,
  irRequest: IrRequest,
  _startTime: number,
): Promise<void> {
  const parser =
    providerProtocol === "anthropic"
      ? new AnthropicSseParser()
      : providerProtocol === "openai-responses"
        ? new OpenAIResponsesSseParser()
        : new OpenAIChatSseParser();

  const isResponsesFormatter = clientProtocol === "openai-responses";
  const formatter =
    clientProtocol === "anthropic"
      ? new AnthropicSseFormatter(
          irRequest.meta.requestId,
          irRequest.meta.originalModel,
        )
      : isResponsesFormatter
        ? new OpenAIResponsesSseFormatter(
            irRequest.meta.requestId,
            irRequest.meta.originalModel,
          )
        : new OpenAIChatSseFormatter(
            irRequest.meta.requestId,
            irRequest.meta.originalModel,
          );

  let buffer = "";
  let lastUsage: { inputTokens: number; outputTokens: number } | undefined;
  let lastStopReason = "stop";

  if (
    isResponsesFormatter &&
    formatter instanceof OpenAIResponsesSseFormatter
  ) {
    res.write(formatter.start());
  }

  const flushLine = (line: string): void => {
    try {
      const deltas = parser.parseLine(line);
      if (!deltas || deltas.length === 0) return;

      for (const delta of deltas) {
        if (delta.type === "usage") lastUsage = delta.usage;
        if (delta.type === "done") lastStopReason = delta.stopReason;
      }

      const out = formatter.formatDeltas(deltas);
      if (!out) return;

      if (typeof out === "string") {
        res.write(out);
      } else {
        for (const event of out) {
          let sse = "";
          if (event.event) sse += `event: ${event.event}\n`;
          sse += `data: ${event.data}\n\n`;
          res.write(sse);
        }
      }
    } catch (err) {
      log("[Pipeline] Stream parse error:", err);
    }
  };

  return new Promise((resolve) => {
    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.indexOf("data: ") === 0) {
          const dataStr = line.slice(6).trim();
          // Only log SSE data when DevMode is ON — hot-path optimization
          if (isDeveloperMode()) {
            logHttp("pipeline.sseData", { preview: dataStr.slice(0, 200) });
          }
          if (dataStr === "[DONE]") continue;
          flushLine(line);
        }
      }
    });

    stream.on("end", () => {
      if (
        buffer.trim() &&
        buffer.indexOf("data: ") === 0 &&
        buffer.slice(6).trim() !== "[DONE]"
      ) {
        flushLine(buffer);
      }

      if (formatter instanceof AnthropicSseFormatter) {
        for (const event of formatter.finish(lastStopReason)) {
          let sse = "";
          if (event.event) sse += `event: ${event.event}\n`;
          sse += `data: ${event.data}\n\n`;
          res.write(sse);
        }
      } else if (formatter instanceof OpenAIChatSseFormatter) {
        res.write("data: [DONE]\n\n");
      } else if (formatter instanceof OpenAIResponsesSseFormatter) {
        res.write(formatter.done(lastStopReason, lastUsage));
      }

      res.end();
      resolve();
    });

    stream.on("error", (err) => {
      log("[Pipeline] Stream error:", err);
      res.end();
      resolve();
    });
  });
}

async function drainStream(stream: IncomingMessage): Promise<void> {
  return new Promise((resolve) => {
    stream.resume();
    stream.on("end", resolve);
    stream.on("error", resolve);
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message, type: "proxy_error" } }));
}
