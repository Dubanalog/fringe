import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { join } from 'node:path';
import { ENGINE_VERSION } from '@fringe/budget-engine';
import { app } from 'electron';
import importGuide from '../../../../docs/ai/import-assistant.md?raw';
import type { McpStatus } from '../shared/ipc';

import { AI_TOOLS, runAppTool } from './ai-tools';
import { writeAtomic } from './projects';

type ServerStatus = Omit<McpStatus, 'enabled'>;

/** Header the app's own chat panel sends, so its edits wait for the user's OK in the panel. */
export const PANEL_CLIENT_HEADER = 'x-fringe-client';

/**
 * The app's MCP server, so an AI client (Claude Code in the app's terminal, Claude Desktop, any
 * MCP client) can read and edit the open budget with the tools in budget-engine/src/tools.ts.
 *
 * Streamable HTTP, JSON responses only, on 127.0.0.1. Every request needs the app's token
 * (kept in the user's app data) and is refused if a web page sent it (an Origin that isn't
 * local), so nothing else on the machine or the web can reach the budget.
 *
 * Budget tool calls run in the window, on the budget showing there or an open one the AI names, so
 * an edit goes into that budget's history and is saved like any other change, and the user sees it
 * happen. Budgets that aren't open can be read, not changed (ai-tools.ts).
 */

export type ToolCaller = (
  name: string,
  input: unknown,
  options: { confirm: boolean },
) => Promise<{ ok: true; result: unknown } | { ok: false; error: string }>;

const PORT = 47615;
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 1_000_000;

const INSTRUCTIONS = `You are working on film/TV budgets in the Fringe app. Work as an experienced
production accountant would: rates and fringes come from the user's files first; say when a figure is
your estimate and list estimates in the budget's assumptions; point out what's missing or looks off.
Tools work on the budget showing in the app unless you name another (list_budgets lists them, with
the user's instructions for all budgets); only budgets open in the app can be changed.
Read before you change: knowledge/instructions.md (list_budget_files), get_budget_summary, then
get_account or get_import_report. The budget's knowledge folder holds what the user has
given you: rate sheets, rules, contracts, deal memos.
When the user asks you to remember something or always do something a certain way, add it to their
instructions with update_instructions.
Every edit goes into the budget's history; the user can undo it. Say what you changed and why.
Never change a line's numbers to make a total match.
For what changed between saved versions (History tab), use compare_versions, which works it out from
the history. When the user is about to save a version, fill in the form with fill_version_form; for
a saved one use update_version. Never put "What changed" in the assumptions.
Fringe has no importer for other programs' budget files: when the user gives you one to convert,
read it and build the budget with the tools, following the import_assistant prompt.
Add-ons are pages on top of Fringe (a cash flow, a hiring plan…) that work on any budget and keep
their own data in it: list_addons lists them and gives the guide to building one (save_addon);
get_addon_data and set_addon_data read and fill in their figures.`;

let server: Server | null = null;
let status: ServerStatus = { running: false, url: null, token: null, error: null };

const tokenFile = () => join(app.getPath('userData'), 'mcp-token');

/** The app's own random token, made the first time; it isn't from any account. */
async function loadToken(): Promise<string> {
  const file = tokenFile();
  try {
    const token = (await readFile(file, 'utf8')).trim();
    if (/^[0-9a-f]{64}$/.test(token)) return token;
  } catch {
    // Made below.
  }
  const token = randomBytes(32).toString('hex');
  await writeAtomic(file, token);
  return token;
}

export function mcpStatus(): ServerStatus {
  return status;
}

export async function startMcpServer(callTool: ToolCaller): Promise<ServerStatus> {
  if (server) return status;
  const token = await loadToken();
  const expected = Buffer.from(`Bearer ${token}`);
  const authorized = (req: IncomingMessage) => {
    const got = Buffer.from(req.headers.authorization ?? '');
    return got.length === expected.length && timingSafeEqual(got, expected);
  };

  const s = createServer((req, res) => void handle(req, res, authorized, callTool));
  const listen = (port: number) =>
    new Promise<number>((resolve, reject) => {
      s.once('error', reject);
      s.listen(port, '127.0.0.1', () => {
        s.off('error', reject);
        const address = s.address();
        resolve(typeof address === 'object' && address ? address.port : port);
      });
    });
  try {
    // A fixed port keeps clients' settings working from one run to the next; another if it's taken.
    const port = await listen(PORT).catch(() => listen(0));
    server = s;
    status = { running: true, url: `http://127.0.0.1:${port}/mcp`, token, error: null };
  } catch (err) {
    status = {
      running: false,
      url: null,
      token: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return status;
}

export function stopMcpServer(): Promise<void> {
  const s = server;
  server = null;
  status = { running: false, url: null, token: null, error: null };
  if (!s) return Promise.resolve();
  return new Promise((resolve) => {
    s.close(() => resolve());
    // Apps still connected with the old token are cut off too.
    s.closeAllConnections();
  });
}

/** Makes a new token, so any app given the old one can't connect any more. */
export async function newMcpToken(callTool: ToolCaller): Promise<ServerStatus> {
  await writeAtomic(tokenFile(), randomBytes(32).toString('hex'));
  if (!server) return status;
  await stopMcpServer();
  return startMcpServer(callTool);
}

function send(res: ServerResponse, code: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(code).end();
    return;
  }
  res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

const localOrigin = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  authorized: (req: IncomingMessage) => boolean,
  callTool: ToolCaller,
): Promise<void> {
  const origin = req.headers.origin;
  if (origin && !localOrigin.test(origin)) return send(res, 403);
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(req.headers.host ?? '')) return send(res, 403);
  if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== '/mcp') return send(res, 404);
  if (!authorized(req)) return send(res, 401, { error: 'The app token is missing or wrong.' });
  if (req.method === 'DELETE') return send(res, 200);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, DELETE');
    return send(res, 405);
  }

  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > MAX_BODY) return send(res, 413);
  }
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return send(res, 400, rpcError(null, -32700, 'Parse error'));
  }
  const messages = Array.isArray(message) ? message : [message];
  const confirm = req.headers[PANEL_CLIENT_HEADER] === 'panel';
  const replies = (await Promise.all(messages.map((m) => respond(m, callTool, confirm)))).filter(
    (r) => r !== null,
  );
  if (replies.length === 0) return send(res, 202);
  return send(res, 200, Array.isArray(message) ? replies : replies[0]);
}

interface Rpc {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcError(id: Rpc['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function respond(raw: unknown, callTool: ToolCaller, confirm: boolean): Promise<unknown> {
  const m = raw as Rpc;
  if (!m || typeof m !== 'object' || typeof m.method !== 'string') {
    // A response from the client, or nonsense: nothing to answer.
    return m && typeof m === 'object' && 'id' in m && !('result' in m || 'error' in m)
      ? rpcError(m.id, -32600, 'Invalid request')
      : null;
  }
  if (m.id === undefined) return null; // A notification.
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: m.id, result });
  const params = m.params ?? {};

  switch (m.method) {
    case 'initialize': {
      const asked = typeof params['protocolVersion'] === 'string' ? params['protocolVersion'] : '';
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: {
          name: 'fringe',
          title: 'Fringe budget',
          version: `${app.getVersion()} (engine ${ENGINE_VERSION})`,
        },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({
        tools: AI_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: {
            readOnlyHint: !t.edits,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        })),
      });
    case 'tools/call': {
      const name = params['name'];
      const args = params['arguments'] ?? {};
      const appTool = runAppTool(name, args);
      if (appTool) {
        try {
          const result = await appTool;
          return ok({ content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] });
        } catch (err) {
          return ok({
            content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
            isError: true,
          });
        }
      }
      if (typeof name !== 'string' || !AI_TOOLS.some((t) => t.name === name)) {
        return rpcError(m.id, -32602, `Unknown tool: ${String(name)}`);
      }
      const outcome = await callTool(name, args, { confirm });
      return ok(
        outcome.ok
          ? { content: [{ type: 'text', text: JSON.stringify(outcome.result, null, 1) }] }
          : { content: [{ type: 'text', text: outcome.error }], isError: true },
      );
    }
    case 'prompts/list':
      return ok({
        prompts: [
          {
            name: 'import_assistant',
            title: 'Import assistant',
            description:
              'Convert a budget made in another program: build it, check it against the file, and report back.',
          },
        ],
      });
    case 'prompts/get':
      if (params['name'] !== 'import_assistant') return rpcError(m.id, -32602, 'Unknown prompt');
      return ok({
        description: 'Import assistant',
        messages: [{ role: 'user', content: { type: 'text', text: importGuide } }],
      });
    default:
      return rpcError(m.id, -32601, `Method not found: ${m.method}`);
  }
}
