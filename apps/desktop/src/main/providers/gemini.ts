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
 * Google's Gemini models, through the Gemini API (generativelanguage.googleapis.com) with a key
 * from Google AI Studio. The model's parts go back exactly as they came: Gemini needs its thought
 * signatures returned with the tool calls they belong to.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta';

type Part = Record<string, unknown>;
interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

function apiError(status: number, body: string): ApiError {
  const message = errorMessage(body);
  if (status === 401 || status === 403 || /api key not valid|API_KEY_INVALID/i.test(message)) {
    return new ApiError("Google didn't accept the Gemini API key.", true);
  }
  if (status === 429) {
    return new ApiError(
      /quota/i.test(message)
        ? 'The Gemini key has used up its allowance for now. Wait a while, or turn on billing in Google AI Studio.'
        : 'Gemini is getting too many requests. Wait a minute and try again.',
    );
  }
  if (status >= 500) return new ApiError('Gemini is busy right now. Try again in a minute.');
  if (status === 404)
    return new ApiError(`Google doesn't offer that model to this key. Pick another in AI settings.`);
  return new ApiError(message || `Gemini couldn't answer (${status}).`);
}

/** Only plain text: a part with nothing else on it, which can join the text before it. */
const plainText = (p: Part | undefined) =>
  p !== undefined && Object.keys(p).length === 1 && typeof p['text'] === 'string';

function conversation(): Conversation {
  let contents: Content[] = [];
  let made = 0;

  const reply = async (o: ReplyOptions): Promise<ToolCall[]> => {
    const res = await fetch(`${API}/models/${encodeURIComponent(o.model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      signal: o.signal,
      headers: { 'x-goog-api-key': o.key, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: o.system }] },
        contents,
        tools: [
          {
            functionDeclarations: o.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parametersJsonSchema: t.inputSchema,
            })),
          },
        ],
      }),
    });
    if (!res.ok || !res.body) throw apiError(res.status, await res.text().catch(() => ''));

    const parts: Part[] = [];
    let blocked = '';
    await readEvents(res.body, (data) => {
      const ev = JSON.parse(data) as {
        candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
        promptFeedback?: { blockReason?: string };
        error?: { message?: string };
      };
      if (ev.error) throw new ApiError(ev.error.message ?? 'Gemini stopped with an error.');
      if (ev.promptFeedback?.blockReason) blocked = ev.promptFeedback.blockReason;
      const candidate = ev.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) {
        if (part['thought'] === true) {
          o.onThinking();
          continue;
        }
        if (typeof part['text'] === 'string' && part['text']) o.onText(part['text']);
        const last = parts[parts.length - 1];
        if (plainText(part) && plainText(last)) last!['text'] = String(last!['text']) + String(part['text']);
        else parts.push({ ...part });
      }
      const reason = candidate?.finishReason;
      if (reason && /SAFETY|PROHIBITED|BLOCKLIST|SPII/.test(reason)) blocked = reason;
    });
    if (parts.length === 0) {
      throw new ApiError(
        blocked
          ? "Gemini wouldn't answer that one. Try putting it another way."
          : 'Gemini sent back an empty answer. Try again.',
      );
    }
    contents.push({ role: 'model', parts });
    return parts
      .filter((p) => p['functionCall'])
      .map((p) => {
        const call = p['functionCall'] as { id?: string; name?: string; args?: Record<string, unknown> };
        // Older models don't number their calls; Fringe does, to match the results up.
        if (!call.id) call.id = `call-${++made}`;
        return { id: call.id, name: String(call.name), input: call.args ?? {} };
      });
  };

  return {
    addUser: (text) => contents.push({ role: 'user', parts: [{ text }] }),
    reply,
    addResults: (results: ToolResult[]) =>
      contents.push({
        role: 'user',
        parts: results.map((r) => ({
          functionResponse: {
            ...(r.call.id.startsWith('call-') ? {} : { id: r.call.id }),
            name: r.call.name,
            response: r.media
              ? { result: r.text, file: { $ref: r.media.name } }
              : r.isError
                ? { error: r.text }
                : { result: r.text },
            ...(r.media
              ? {
                  parts: [
                    {
                      inlineData: {
                        mimeType: r.media.mimeType,
                        data: r.media.data,
                        displayName: r.media.name,
                      },
                    },
                  ],
                }
              : {}),
          },
        })),
      }),
    length: () => contents.length,
    truncate: (n) => {
      contents = contents.slice(0, n);
    },
  };
}

const CHEAP = /-lite\b/;

/**
 * The Gemini chat models this key can use: Gemini 3 and later, newest first, Flash (quick and
 * cheap, and in the free allowance) before Pro, Lite last. No dated snapshots or special-purpose
 * models (speech, images, live audio).
 */
export function chooseModels(
  models: readonly { name: string; displayName: string; methods: string[] }[],
): ModelChoice[] {
  const version = (id: string) => Number(/^gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);
  const rank = (id: string) => (CHEAP.test(id) ? 2 : /-flash/.test(id) ? 0 : 1);
  return models
    .map((m) => ({ ...m, id: m.name.replace(/^models\//, '') }))
    .filter(
      (m) =>
        m.methods.includes('generateContent') &&
        /^gemini-\d/.test(m.id) &&
        version(m.id) >= 3 &&
        !/(tts|image|live|audio|embedding|robotics|computer-use|customtools|native|exp|\d{2}-\d{4})/.test(
          m.id,
        ),
    )
    .sort((a, b) => rank(a.id) - rank(b.id) || version(b.id) - version(a.id) || a.id.localeCompare(b.id))
    .map((m, i) => ({
      id: m.id,
      label:
        (m.displayName || m.id) +
        (i === 0 ? ' (recommended)' : rank(m.id) === 1 ? ' (most capable, costs more)' : ''),
    }));
}

export const gemini: Provider = {
  id: 'gemini',
  company: 'Google',
  keyUrl: 'https://aistudio.google.com/apikey',
  looksLikeKey: (key) => /^[\w.-]{30,200}$/.test(key),
  async testKey(key) {
    const res = await fetch(`${API}/models?pageSize=1`, { headers: { 'x-goog-api-key': key } });
    if (res.ok) return null;
    const message = errorMessage(await res.text().catch(() => ''));
    if (res.status === 400 || res.status === 401 || res.status === 403 || /api key/i.test(message)) {
      return "Google didn't accept that key. Check you copied all of it.";
    }
    return `Google answered ${res.status}. Try again in a minute.`;
  },
  async models(key) {
    const res = await fetch(`${API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[];
    };
    return chooseModels(
      (body.models ?? []).map((m) => ({
        name: m.name ?? '',
        displayName: m.displayName ?? '',
        methods: m.supportedGenerationMethods ?? [],
      })),
    );
  },
  conversation,
};
