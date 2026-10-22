import type { KeyProvider } from '../../shared/ipc';

/**
 * What the API-key chat needs from each AI company: checking a key, listing its models, and one
 * conversation in that company's own format. The chat loop (apichat.ts) is the same for all.
 */

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** A PDF or picture from the budget's files, for the model to read. */
export interface Media {
  name: string;
  mimeType: string;
  /** Base64. */
  data: string;
}

export interface ToolResult {
  call: ToolCall;
  text: string;
  media: Media | null;
  isError: boolean;
}

export interface ModelChoice {
  id: string;
  label: string;
}

/** A refusal from the company's API, in plain words; `setup` when the key is the problem. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly setup = false,
  ) {
    super(message);
  }
}

export interface ReplyOptions {
  key: string;
  model: string;
  system: string;
  tools: readonly ToolSpec[];
  signal: AbortSignal;
  onText(text: string): void;
  onThinking(): void;
}

/** One chat's history, kept in the company's own format. */
export interface Conversation {
  addUser(text: string): void;
  /** Gets the model's next reply (streamed through onText) and adds it; returns the tools it asked for. */
  reply(options: ReplyOptions): Promise<ToolCall[]>;
  addResults(results: ToolResult[]): void;
  /** For taking back an unfinished exchange. */
  length(): number;
  truncate(length: number): void;
}

export interface Provider {
  id: KeyProvider;
  /** The company, e.g. "OpenAI". */
  company: string;
  /** Where to make a key. */
  keyUrl: string;
  looksLikeKey(key: string): boolean;
  /** Null when the key works; otherwise what's wrong, in plain words. */
  testKey(key: string): Promise<string | null>;
  /** Models to offer, best default first. */
  models(key: string): Promise<ModelChoice[]>;
  conversation(): Conversation;
}

/** Reads a server-sent-events body, calling back with each event's data. */
export async function readEvents(
  body: ReadableStream<Uint8Array>,
  onData: (data: string, event: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
    let end: number;
    while ((end = pending.indexOf('\n\n')) >= 0) {
      const frame = pending.slice(0, end);
      pending = pending.slice(end + 2);
      const lines = frame.split('\n');
      const event =
        lines
          .find((l) => l.startsWith('event:'))
          ?.slice(6)
          .trim() ?? '';
      const data = lines
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('');
      if (data && data !== '[DONE]') onData(data, event);
    }
  }
}

/** The message from an API's JSON error body, if there is one. */
export function errorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === 'string') return parsed.error;
    return parsed.error?.message ?? parsed.message ?? '';
  } catch {
    return '';
  }
}

/** Plain words for a failed fetch to a company's API. */
export async function reach<T>(company: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ApiError || (err instanceof DOMException && err.name === 'AbortError')) throw err;
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ApiError(`Couldn't reach ${company}. Check the internet connection.`);
  }
}
