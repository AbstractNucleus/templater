/**
 * Sidecar entrypoint. Reads newline-delimited JSON requests from stdin,
 * writes newline-delimited JSON responses to stdout.
 *
 * Protocol (request):  { "id": string, "op": "ping" | "rank", ...args }
 * Protocol (response): { "id": string, "ok": true, ... } | { "id": string, "ok": false, "error": string }
 *
 * Only "ping" is implemented for now — used by Rust to verify the IPC
 * round-trip end-to-end before any Agent SDK calls go in.
 */

import { createInterface } from "node:readline";

type PingRequest = { id: string; op: "ping" };
type RankRequest = {
  id: string;
  op: "rank";
  pasted: string;
  catalog: Array<{
    id: string;
    name: string;
    tags: string[];
    opening?: string;
    body: string;
  }>;
};
type Request = PingRequest | RankRequest;

type Response =
  | { id: string; ok: true; [k: string]: unknown }
  | { id: string; ok: false; error: string };

function send(response: Response): void {
  process.stdout.write(JSON.stringify(response) + "\n");
}

function handle(request: Request): Response {
  switch (request.op) {
    case "ping":
      return { id: request.id, ok: true, pong: true, pid: process.pid };
    case "rank":
      return {
        id: request.id,
        ok: false,
        error: "rank not yet implemented — Agent SDK call lands in the next commit",
      };
    default: {
      const _exhaustive: never = request;
      return { id: (_exhaustive as { id: string }).id, ok: false, error: "unknown op" };
    }
  }
}

const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed === "") return;

  let request: Request;
  try {
    request = JSON.parse(trimmed) as Request;
  } catch (err) {
    send({ id: "?", ok: false, error: `parse error: ${(err as Error).message}` });
    return;
  }

  try {
    send(handle(request));
  } catch (err) {
    send({ id: request.id, ok: false, error: (err as Error).message });
  }
});

rl.on("close", () => process.exit(0));

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

process.stderr.write(`sidecar ready (pid ${process.pid})\n`);
