export type ProtocolRequest = Record<string, unknown> & {
  id: string;
  op: string;
};

export type ProtocolErrorResponse = {
  id: string;
  ok: false;
  error: string;
};

export type ParseRequestResult =
  | { ok: true; request: ProtocolRequest }
  | { ok: false; response: ProtocolErrorResponse };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseId(value: unknown): string {
  return isRecord(value) && typeof value.id === "string" ? value.id : "?";
}

export function parseRequestLine(line: string): ParseRequestResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    return {
      ok: false,
      response: { id: "?", ok: false, error: `parse error: ${(err as Error).message}` },
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      response: { id: "?", ok: false, error: "request must be a JSON object" },
    };
  }
  if (typeof parsed.id !== "string" || parsed.id.length === 0) {
    return {
      ok: false,
      response: { id: responseId(parsed), ok: false, error: "request id must be a non-empty string" },
    };
  }
  if (typeof parsed.op !== "string" || parsed.op.length === 0) {
    return {
      ok: false,
      response: { id: parsed.id, ok: false, error: "request op must be a non-empty string" },
    };
  }

  return { ok: true, request: parsed as ProtocolRequest };
}
