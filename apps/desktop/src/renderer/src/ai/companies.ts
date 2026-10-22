import type { KeyProvider } from '../../../shared/ipc';

/** What the panel says about each company whose API key the chat can use. */
export const COMPANIES: Record<
  KeyProvider,
  {
    /** The settings choice, e.g. "An OpenAI API key". */
    title: string;
    company: string;
    /** The models, e.g. "GPT". */
    assistant: string;
    keyUrl: string;
    keySite: string;
    placeholder: string;
    /** How they charge, and anything else worth knowing first. */
    note: string;
  }
> = {
  anthropic: {
    title: 'An Anthropic API key',
    company: 'Anthropic',
    assistant: 'Claude',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keySite: 'console.anthropic.com',
    placeholder: 'sk-ant-…',
    note: 'Claude, pay as you go: Anthropic bills your account for what it reads and writes.',
  },
  openai: {
    title: 'An OpenAI API key',
    company: 'OpenAI',
    assistant: 'GPT',
    keyUrl: 'https://platform.openai.com/api-keys',
    keySite: 'platform.openai.com',
    placeholder: 'sk-…',
    note: "GPT, pay as you go: OpenAI bills your account for what it reads and writes. A ChatGPT plan doesn't include this.",
  },
  gemini: {
    title: 'A Google Gemini API key',
    company: 'Google',
    assistant: 'Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    keySite: 'aistudio.google.com',
    placeholder: 'Paste the key',
    note: 'Gemini, with a free allowance to start. On the free allowance Google may use what you send to improve its products; turn on billing in AI Studio to keep budgets private.',
  },
};
