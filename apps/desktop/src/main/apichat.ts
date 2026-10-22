import { readFile, rm, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { type WebContents, app, safeStorage } from 'electron';
import { type ChatEvent, IpcChannel, KEY_PROVIDERS, type KeyProvider } from '../shared/ipc';
import { AI_TOOLS, projectFor, runAppTool } from './ai-tools';
import { budgetFilePath } from './knowledge';
import type { ToolCaller } from './mcp';
import { writeAtomic } from './projects';
import { anthropic } from './providers/anthropic';
import { gemini } from './providers/gemini';
import { openai } from './providers/openai';
import {
  ApiError,
  type Conversation,
  type Media,
  type ModelChoice,
  type Provider,
  type ToolCall,
  type ToolSpec,
  reach,
} from './providers/types';

/**
 * The side panel's chat with the user's own API key from Anthropic, OpenAI or Google, for anyone
 * without Claude Code. The app talks to that company's API itself (nowhere else) and runs the tools
 * in process: budget edits go through the window, which asks the user to allow each one, like the
 * Claude Code chat. Keys are kept encrypted with the system's keychain (safeStorage) and never
 * leave the main process.
 */

export const PROVIDERS: Record<KeyProvider, Provider> = { anthropic, openai, gemini };

/** Tool rounds in one answer before the model has to stop and report. */
const MAX_ROUNDS = 25;
const MEDIA: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const MAX_MEDIA = 20_000_000;

const keyFile = (provider: KeyProvider) => join(app.getPath('userData'), `${provider}-key.bin`);

export async function hasApiKey(provider: KeyProvider): Promise<boolean> {
  return (await stat(keyFile(provider)).catch(() => null))?.isFile() ?? false;
}

export async function savedKeys(): Promise<Record<KeyProvider, boolean>> {
  const entries = await Promise.all(KEY_PROVIDERS.map(async (p) => [p, await hasApiKey(p)] as const));
  return Object.fromEntries(entries) as Record<KeyProvider, boolean>;
}

async function loadKey(provider: KeyProvider): Promise<string | null> {
  try {
    return safeStorage.decryptString(Buffer.from(await readFile(keyFile(provider), 'utf8'), 'base64'));
  } catch {
    return null;
  }
}

/**
 * Whether the system can really keep a secret: Windows (DPAPI) and macOS (Keychain) always can.
 * On Linux it needs a keyring (GNOME Keyring or KWallet); without one, Electron still "encrypts"
 * but with a password built into Chromium ('basic_text'), which is no better than plain text.
 */
function canKeepSecrets(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform !== 'linux') return true;
  const backend = safeStorage.getSelectedStorageBackend();
  return backend !== 'basic_text' && backend !== 'unknown';
}

/** Keeps the key encrypted; refuses to store it in the clear if the system can't encrypt. */
async function saveApiKey(provider: KeyProvider, key: string): Promise<void> {
  if (!canKeepSecrets()) {
    throw new Error(
      process.platform === 'linux'
        ? "The key wasn't saved: this computer has no keyring to keep it in safely (GNOME Keyring or KWallet)."
        : "This computer can't keep the key safely, so it wasn't saved.",
    );
  }
  await writeAtomic(keyFile(provider), safeStorage.encryptString(key).toString('base64'));
}

/** Checks a key with its company, then keeps it. Null when saved; otherwise what's wrong. */
export async function setApiKey(provider: KeyProvider, key: string): Promise<string | null> {
  const p = PROVIDERS[provider];
  if (!p.looksLikeKey(key))
    return `That doesn't look like an ${p.company} API key. Check you copied all of it.`;
  let problem: string | null;
  try {
    problem = await reach(p.company, () => p.testKey(key));
  } catch (err) {
    return (err as Error).message;
  }
  if (problem) return problem;
  try {
    await saveApiKey(provider, key);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  modelLists.delete(provider);
  if (provider === current?.provider) newApiChat();
  return null;
}

export async function clearApiKey(provider: KeyProvider): Promise<void> {
  await rm(keyFile(provider), { force: true });
  modelLists.delete(provider);
}

const modelLists = new Map<KeyProvider, ModelChoice[]>();

/** The models a provider's key can use, best default first; asked once a session, then kept. */
export async function modelChoices(provider: KeyProvider): Promise<ModelChoice[]> {
  const known = modelLists.get(provider);
  if (known) return known;
  const key = await loadKey(provider);
  const list = key ? await PROVIDERS[provider].models(key).catch(() => []) : [];
  if (list.length > 0) modelLists.set(provider, list);
  return list;
}

let current: { provider: KeyProvider; conversation: Conversation } | null = null;
let running: AbortController | null = null;
let output: WebContents | null = null;

function emit(event: ChatEvent): void {
  if (output && !output.isDestroyed()) output.send(IpcChannel.chatEvent, event);
}

const TOOLS: ToolSpec[] = AI_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema,
}));

/** A PDF or picture from the budget's files, for the model to read. */
async function readMedia(input: Record<string, unknown>): Promise<Media | null> {
  const project = await projectFor(input).catch(() => null);
  const full = project ? budgetFilePath(project, input['name']) : null;
  const mimeType = full ? MEDIA[extname(full).toLowerCase()] : undefined;
  if (!full || !mimeType) return null;
  const size = (await stat(full).catch(() => null))?.size ?? 0;
  if (size === 0 || size > MAX_MEDIA) return null;
  return { name: String(input['name']), mimeType, data: (await readFile(full)).toString('base64') };
}

async function runTool(
  call: ToolCall,
  callTool: ToolCaller,
): Promise<{ text: string; media: Media | null; isError: boolean }> {
  const { name, input } = call;
  try {
    if (name === 'read_budget_file') {
      const media = await readMedia(input);
      if (media) return { text: `${media.name}:`, media, isError: false };
    }
    const appTool = runAppTool(name, input);
    if (appTool) return { text: JSON.stringify(await appTool, null, 1), media: null, isError: false };
    if (!AI_TOOLS.some((t) => t.name === name))
      return { text: `Unknown tool: ${name}`, media: null, isError: true };
    const outcome = await callTool(name, input, { confirm: true });
    return outcome.ok
      ? { text: JSON.stringify(outcome.result, null, 1), media: null, isError: false }
      : { text: outcome.error, media: null, isError: true };
  } catch (err) {
    return { text: err instanceof Error ? err.message : String(err), media: null, isError: true };
  }
}

/** Sends the user's message and runs the model's answer, tools and all, to the end. */
export async function sendApiChat(
  contents: WebContents,
  text: string,
  options: {
    provider: KeyProvider;
    model: string;
    system: string;
    callTool: ToolCaller;
    describe: (name: string, input: Record<string, unknown>) => string;
  },
): Promise<void> {
  output = contents;
  const provider = PROVIDERS[options.provider];
  const key = await loadKey(options.provider);
  if (!key) {
    emit({ type: 'setup', problem: 'needs-key', detail: '' });
    return;
  }
  stopApiChat();
  if (current?.provider !== options.provider) {
    current = { provider: options.provider, conversation: provider.conversation() };
  }
  const chat = current.conversation;
  const controller = new AbortController();
  running = controller;
  const before = chat.length();
  chat.addUser(text);
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const calls = await reach(provider.company, () =>
        chat.reply({
          key,
          model: options.model,
          system: options.system,
          tools: TOOLS,
          signal: controller.signal,
          onText: (t) => emit({ type: 'text', text: t }),
          onThinking: () => emit({ type: 'thinking' }),
        }),
      );
      if (calls.length === 0) break;
      const results = [];
      for (const call of calls) {
        emit({ type: 'step', name: call.name, label: options.describe(call.name, call.input) });
        const r = await runTool(call, options.callTool);
        if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        results.push({ call, ...r });
      }
      chat.addResults(results);
    }
    if (running === controller) running = null;
    emit({ type: 'turn-end', error: null });
  } catch (err) {
    if (running === controller) running = null;
    // Keep the conversation valid for the next message: drop this unfinished exchange.
    chat.truncate(before);
    if (controller.signal.aborted) return;
    const e = err as Error;
    if (e instanceof ApiError && e.setup) emit({ type: 'setup', problem: 'needs-key', detail: e.message });
    else emit({ type: 'turn-end', error: e.message || `Couldn't reach ${provider.company}.` });
  }
}

export function stopApiChat(): void {
  running?.abort();
  running = null;
}

export function newApiChat(): void {
  stopApiChat();
  current = null;
}
