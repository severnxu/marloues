export interface EndpointDiagnosticInput {
  baseUrl?: unknown;
  apiKey?: unknown;
  model?: unknown;
  protocol?: unknown;
  timeoutMs?: number;
}

export interface EndpointDiagnosticResult {
  ok: boolean;
  status?: number;
  message: string;
  body?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

type DiagnosticProtocol = "anthropic" | "openai-chat" | "openai-responses";

export async function diagnoseEndpointModel(
  input: EndpointDiagnosticInput,
): Promise<EndpointDiagnosticResult> {
  const protocol = readProtocol(input.protocol);
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (!baseUrl)
    return { ok: false, message: "Model endpoint is missing Base URL." };
  if (!apiKey)
    return { ok: false, message: "Model endpoint is missing API Key." };
  if (!model)
    return { ok: false, message: "Model endpoint is missing model ID." };

  let url: string;
  try {
    url = buildEndpointUrl(baseUrl, protocol);
  } catch (error) {
    return {
      ok: false,
      message: `Model endpoint Base URL is invalid: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: diagnosticHeaders(protocol, apiKey),
      body: JSON.stringify(diagnosticRequestBody(protocol, model)),
      signal: controller.signal,
    });
    const body = await readBodyPreview(response);
    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        message:
          "Diagnostic request succeeded; the endpoint can generate content.",
        body,
      };
    }
    return {
      ok: false,
      status: response.status,
      message: explainEndpointError(response.status, body),
      body,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.name === "AbortError"
          ? "Diagnostic request timed out before the endpoint returned a response."
          : `Diagnostic request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function diagnoseAnthropicCompatibleEndpoint(
  input: EndpointDiagnosticInput,
): Promise<EndpointDiagnosticResult> {
  return diagnoseEndpointModel({ ...input, protocol: "anthropic" });
}

export function buildMessagesUrl(baseUrl: string): string {
  return buildEndpointUrl(baseUrl, "anthropic");
}

function buildEndpointUrl(
  baseUrl: string,
  protocol: DiagnosticProtocol,
): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  const endpointPath =
    protocol === "anthropic"
      ? "/messages"
      : protocol === "openai-chat"
        ? "/chat/completions"
        : "/responses";
  url.pathname = path.endsWith("/v1")
    ? `${path}${endpointPath}`
    : `${path}/v1${endpointPath}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function diagnosticHeaders(
  protocol: DiagnosticProtocol,
  apiKey: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (protocol === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers.authorization = `Bearer ${apiKey}`;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function diagnosticRequestBody(
  protocol: DiagnosticProtocol,
  model: string,
): Record<string, unknown> {
  if (protocol === "anthropic") {
    return {
      model,
      max_tokens: 1,
      stream: false,
      messages: [{ role: "user", content: "ping" }],
    };
  }
  if (protocol === "openai-chat") {
    return {
      model,
      max_tokens: 1,
      stream: false,
      messages: [{ role: "user", content: "ping" }],
    };
  }
  return {
    model,
    max_output_tokens: 16,
    stream: false,
    input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
  };
}

function readProtocol(value: unknown): DiagnosticProtocol {
  return value === "openai-chat" || value === "openai-responses"
    ? value
    : "anthropic";
}

function explainEndpointError(status: number, body: string): string {
  const compactBody = body.trim();
  if (/2056|usage limit exceeded/i.test(compactBody)) {
    return "Endpoint returned usage limit exceeded (2056). Check token plan quota or try another model.";
  }
  if (/1008|insufficient balance/i.test(compactBody)) {
    return "Endpoint returned insufficient balance (1008). Check account balance or token plan resources.";
  }
  if (
    status === 401 ||
    status === 403 ||
    /invalid api key|not authorized|token/i.test(compactBody)
  ) {
    return `Endpoint authorization failed (HTTP ${status}). Check API key and model permissions.`;
  }
  if (status === 429 || /rate_limit/i.test(compactBody)) {
    return `Endpoint is rate limited or quota is exhausted (HTTP ${status}). Try again later or check quota.`;
  }
  return `Endpoint returned HTTP ${status}: ${compactBody || "empty response body"}`;
}

async function readBodyPreview(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 2_000 ? `${text.slice(0, 2_000)}...` : text;
  } catch {
    return "";
  }
}
