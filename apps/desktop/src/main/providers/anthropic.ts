import {
  ApiError,
  type Conversation,
  type Provider,
  type ReplyOptions,
  type ToolCall,
  type ToolResult,
  errorMessage,
  readEvents,
} from './types';

/** Claude, through the Messages API (api.anthropic.com). */

const API = 'https://api.anthropic.com/v1';
const VERSION = '2023-06-01';
const MAX_TOKENS = 8192;

type Block = Record<string, unknown> & { type: string };
interface Message {
  role: 'user' | 'assistant';
  content: string | Block[];
}

function apiError(status: number, body: string): ApiError {
  const message = errorMessage(body);
  if (status === 401) return new ApiError("Anthropic didn't accept the API key.", true);
  if (/credit balance/i.test(message)) {
    return new ApiError(
      'Your Anthropic account is out of credit. Add credit at console.anthropic.com, then try again.',
    );
  }
  if (status === 429)
    return new ApiError('Claude is getting too many requests. Wait a minute and try again.');
  if (status === 529 || status >= 500)
    return new ApiError('Claude is busy right now. Try again in a minute.');
  return new ApiError(message || `Claude couldn't answer (${status}).`);
}

function conversation(): Conversation {
  let history: Message[] = [];

  const reply = async (o: ReplyOptions): Promise<ToolCall[]> => {
    const tools = o.tools.map((t, i) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
      ...(i === o.tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
    }));
    const res = await fetch(`${API}/messages`, {
      method: 'POST',
      signal: o.signal,
      headers: { 'x-api-key': o.key, 'anthropic-version': VERSION, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: o.model,
        max_tokens: MAX_TOKENS,
        stream: true,
        system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }],
        tools,
        messages: history,
      }),
    });
    if (!res.ok || !res.body) throw apiError(res.status, await res.text().catch(() => ''));

    const content: Block[] = [];
    const json: string[] = [];
    await readEvents(res.body, (data) => {
      const ev = JSON.parse(data) as Record<string, unknown> & { type: string; index?: number };
      const i = ev.index ?? 0;
      switch (ev.type) {
        case 'content_block_start': {
          const block = ev['content_block'] as Block;
          content[i] = { ...block };
          json[i] = '';
          if (block.type === 'thinking') o.onThinking();
          break;
        }
        case 'content_block_delta': {
          const d = ev['delta'] as { type: string; text?: string; partial_json?: string };
          const block = content[i];
          if (!block) break;
          if (d.type === 'text_delta' && d.text) {
            block['text'] = String(block['text'] ?? '') + d.text;
            o.onText(d.text);
          } else if (d.type === 'input_json_delta') json[i] = (json[i] ?? '') + (d.partial_json ?? '');
          break;
        }
        case 'content_block_stop': {
          const block = content[i];
          if (block?.type === 'tool_use') {
            try {
              block['input'] = json[i] ? (JSON.parse(json[i]) as unknown) : {};
            } catch {
              block['input'] = {};
            }
          }
          break;
        }
        case 'error': {
          const err = ev['error'] as { type?: string; message?: string };
          throw new ApiError(
            err.type === 'overloaded_error'
              ? 'Claude is busy right now. Try again in a minute.'
              : (err.message ?? 'Claude stopped with an error.'),
          );
        }
      }
    });
    // Thinking blocks go back as they came; drop anything half-made.
    const kept = content.filter((b) => b && (b.type !== 'text' || b['text']));
    history.push({ role: 'assistant', content: kept });
    return kept
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({
        id: String(b['id']),
        name: String(b['name']),
        input: (b['input'] ?? {}) as Record<string, unknown>,
      }));
  };

  return {
    addUser: (text) => history.push({ role: 'user', content: text }),
    reply,
    addResults: (results: ToolResult[]) =>
      history.push({
        role: 'user',
        content: results.map((r) => {
          const source = r.media && { type: 'base64', media_type: r.media.mimeType, data: r.media.data };
          return {
            type: 'tool_result',
            tool_use_id: r.call.id,
            content:
              r.media && source
                ? [
                    { type: 'text', text: r.text },
                    r.media.mimeType === 'application/pdf'
                      ? { type: 'document', source }
                      : { type: 'image', source },
                  ]
                : r.text,
            is_error: r.isError,
          };
        }),
      }),
    length: () => history.length,
    truncate: (n) => {
      history = history.slice(0, n);
    },
  };
}

export const anthropic: Provider = {
  id: 'anthropic',
  company: 'Anthropic',
  keyUrl: 'https://console.anthropic.com/settings/keys',
  looksLikeKey: (key) => /^sk-ant-[\w-]{20,300}$/.test(key),
  async testKey(key) {
    // The model list is free, so this spends nothing.
    const res = await fetch(`${API}/models?limit=1`, {
      headers: { 'x-api-key': key, 'anthropic-version': VERSION },
    });
    if (res.ok) return null;
    if (res.status === 401) return "Anthropic didn't accept that key. Check you copied all of it.";
    if (res.status === 403) return "That key isn't allowed to use Claude.";
    return `Anthropic answered ${res.status}. Try again in a minute.`;
  },
  models: () =>
    Promise.resolve([
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (recommended)' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (most capable, costs more)' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
    ]),
  conversation,
};
