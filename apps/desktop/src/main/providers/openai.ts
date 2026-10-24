import {
  ApiError,
  type Conversation,
  type ModelChoice,
  type Provider,
  type ReplyOptions,
  type ToolCall,
  type ToolResult,
  errorMessage,
  readEvents,
} from './types';

/**
 * OpenAI's GPT models, through the Responses API (api.openai.com). Nothing is kept on OpenAI's side
 * (store: false), so each request carries the whole chat, with the model's reasoning passed back
 * encrypted as OpenAI asks.
 */

const API = 'https://api.openai.com/v1';

type Item = Record<string, unknown> & { type?: string };

function apiError(status: number, body: string): ApiError {
  const message = errorMessage(body);
  if (status === 401) return new ApiError("OpenAI didn't accept the API key.", true);
  if (/quota|billing|credit/i.test(message)) {
    return new ApiError(
      'Your OpenAI account is out of credit. Add credit at platform.openai.com, then try again.',
    );
  }
  if (status === 429)
    return new ApiError('OpenAI is getting too many requests. Wait a minute and try again.');
  if (status >= 500) return new ApiError('OpenAI is busy right now. Try again in a minute.');
  if (status === 404)
    return new ApiError(`OpenAI doesn't offer that model to this key. Pick another in AI settings.`);
  return new ApiError(message || `OpenAI couldn't answer (${status}).`);
}

/**
 * An error OpenAI sent mid-reply, in its own words: the message sits on the event, under `error`, or
 * under `response.error` (or `response.incomplete_details` when it stopped short).
 */
function streamError(ev: Record<string, unknown>): ApiError {
  console.error('OpenAI stream error:', JSON.stringify(ev).slice(0, 2000));
  const response = ev['response'] as Record<string, unknown> | undefined;
  const found = [ev['error'], response?.['error'], ev].find(
    (e): e is { message?: unknown; code?: unknown } => !!e && typeof e === 'object' && 'message' in e,
  );
  const message = String(found?.message ?? '').trim();
  const code = String(found?.code ?? '').trim();
  const reason = (response?.['incomplete_details'] as { reason?: unknown } | undefined)?.reason;
  if (/quota|billing|credit/i.test(`${message} ${code}`)) {
    return new ApiError(
      'Your OpenAI account is out of credit. Add credit at platform.openai.com, then try again.',
    );
  }
  if (/verif/i.test(message)) {
    return new ApiError(
      `${message} Verify your organization at platform.openai.com (Settings › Organization › General), or pick a smaller model in AI settings.`,
    );
  }
  if (message) return new ApiError(code ? `${message} (${code})` : message);
  if (reason) return new ApiError(`OpenAI stopped before finishing (${String(reason)}).`);
  return new ApiError(`OpenAI stopped with an error${code ? ` (${code})` : ''}.`);
}

/** What goes back to OpenAI from its own output: reasoning as it came, the rest without ids. */
function asInput(item: Item): Item | null {
  if (item.type === 'reasoning') return item;
  if (item.type === 'function_call') {
    return {
      type: 'function_call',
      call_id: item['call_id'],
      name: item['name'],
      arguments: item['arguments'],
    };
  }
  if (item.type === 'message') return { type: 'message', role: 'assistant', content: item['content'] };
  return null;
}

function conversation(): Conversation {
  let input: Item[] = [];

  const reply = async (o: ReplyOptions): Promise<ToolCall[]> => {
    const res = await fetch(`${API}/responses`, {
      method: 'POST',
      signal: o.signal,
      headers: { authorization: `Bearer ${o.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: o.model,
        instructions: o.system,
        input,
        tools: o.tools.map((t) => ({
          type: 'function',
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
          strict: false,
        })),
        stream: true,
        store: false,
        include: ['reasoning.encrypted_content'],
      }),
    });
    if (!res.ok || !res.body) throw apiError(res.status, await res.text().catch(() => ''));

    const output: Item[] = [];
    await readEvents(res.body, (data) => {
      const ev = JSON.parse(data) as Record<string, unknown> & { type: string };
      switch (ev.type) {
        case 'response.output_text.delta':
          if (typeof ev['delta'] === 'string' && ev['delta']) o.onText(ev['delta']);
          break;
        case 'response.output_item.added':
          if ((ev['item'] as Item | undefined)?.type === 'reasoning') o.onThinking();
          break;
        case 'response.output_item.done':
          output[Number(ev['output_index'] ?? output.length)] = ev['item'] as Item;
          break;
        case 'response.failed':
        case 'response.incomplete':
        case 'error':
          throw streamError(ev);
      }
    });
    const items = output.filter(Boolean);
    input.push(...items.map(asInput).filter((i): i is Item => i !== null));
    return items
      .filter((i) => i.type === 'function_call')
      .map((i) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(i['arguments'] ?? '{}')) as Record<string, unknown>;
        } catch {
          // Left empty; the tool says what's missing.
        }
        return { id: String(i['call_id']), name: String(i['name']), input: args };
      });
  };

  return {
    addUser: (text) => input.push({ role: 'user', content: text }),
    reply,
    addResults: (results: ToolResult[]) => {
      for (const r of results) {
        const m = r.media;
        const url = m ? `data:${m.mimeType};base64,${m.data}` : '';
        input.push({
          type: 'function_call_output',
          call_id: r.call.id,
          output: m
            ? [
                { type: 'input_text', text: r.text },
                m.mimeType === 'application/pdf'
                  ? { type: 'input_file', filename: m.name, file_data: url }
                  : { type: 'input_image', image_url: url },
              ]
            : r.isError
              ? `Error: ${r.text}`
              : r.text,
        });
      }
    },
    length: () => input.length,
    truncate: (n) => {
      input = input.slice(0, n);
    },
  };
}

/** gpt-6.1-sol → GPT-6.1 Sol. */
function label(id: string): string {
  const [, version, ...rest] = id.split('-');
  return [`GPT-${version}`, ...rest.map((w) => w[0]!.toUpperCase() + w.slice(1))].join(' ');
}

const CHEAP = /-(mini|nano|luna|lite)$/;

/**
 * The GPT chat models this key can use, newest first, the smaller ones after: GPT-5 and later, no
 * dated snapshots or special-purpose models (audio, images, search, code), no slow "pro" ones.
 */
export function chooseModels(ids: readonly string[]): ModelChoice[] {
  const version = (id: string) => Number(/^gpt-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);
  return ids
    .filter(
      (id) =>
        /^gpt-\d+(\.\d+)?(-[a-z]+)?$/.test(id) &&
        version(id) >= 5 &&
        !/-(audio|realtime|image|transcribe|tts|search|codex|chat|latest|oss|pro)$/.test(id),
    )
    .sort(
      (a, b) =>
        Number(CHEAP.test(a)) - Number(CHEAP.test(b)) || version(b) - version(a) || a.localeCompare(b),
    )
    .map((id, i) => ({
      id,
      label: label(id) + (i === 0 ? ' (recommended)' : CHEAP.test(id) ? ' (faster, cheaper)' : ''),
    }));
}

export const openai: Provider = {
  id: 'openai',
  company: 'OpenAI',
  keyUrl: 'https://platform.openai.com/api-keys',
  looksLikeKey: (key) => /^sk-[\w-]{20,400}$/.test(key),
  async testKey(key) {
    const res = await fetch(`${API}/models`, { headers: { authorization: `Bearer ${key}` } });
    if (res.ok) return null;
    if (res.status === 401) return "OpenAI didn't accept that key. Check you copied all of it.";
    if (res.status === 403) return "That key isn't allowed to use OpenAI's models.";
    return `OpenAI answered ${res.status}. Try again in a minute.`;
  },
  async models(key) {
    const res = await fetch(`${API}/models`, { headers: { authorization: `Bearer ${key}` } });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: { id?: unknown }[] };
    return chooseModels((body.data ?? []).map((m) => String(m.id ?? '')));
  },
  conversation,
};
