import { describe, expect, it } from 'vitest';
import { chooseModels as geminiModels } from './gemini';
import { chooseModels as openaiModels } from './openai';

describe('OpenAI model list', () => {
  it('keeps GPT-5 and later chat models, newest first, smaller ones last', () => {
    const list = openaiModels([
      'gpt-4o',
      'gpt-5-mini',
      'gpt-6-astra',
      'gpt-6.1-sol',
      'gpt-6-luna',
      'gpt-6-pro',
      'gpt-6-realtime',
      'gpt-5-2025-08-07',
      'o3',
      'text-embedding-3-large',
    ]);
    expect(list.map((m) => m.id)).toEqual(['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-5-mini']);
    expect(list[0]!.label).toBe('GPT-6.1 Sol (recommended)');
    expect(list[2]!.label).toBe('GPT-6 Luna (faster, cheaper)');
  });

  it('is empty when nothing fits', () => {
    expect(openaiModels(['gpt-4.1', 'dall-e-3'])).toEqual([]);
  });
});

describe('Gemini model list', () => {
  const model = (id: string, displayName = id, methods = ['generateContent']) => ({
    name: `models/${id}`,
    displayName,
    methods,
  });

  it('keeps Gemini 3 and later, Flash first, then Pro, Lite last', () => {
    const list = geminiModels([
      model('gemini-2.5-flash'),
      model('gemini-3.1-pro-preview', 'Gemini 3.1 Pro'),
      model('gemini-3-flash-preview', 'Gemini 3 Flash'),
      model('gemini-3.1-flash', 'Gemini 3.1 Flash'),
      model('gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite'),
      model('gemini-3-flash-image'),
      model('gemini-3.1-flash-tts'),
      model('gemini-embedding-001', 'Embedding', ['embedContent']),
    ]);
    expect(list.map((m) => m.id)).toEqual([
      'gemini-3.1-flash',
      'gemini-3-flash-preview',
      'gemini-3.1-pro-preview',
      'gemini-3.1-flash-lite',
    ]);
    expect(list[0]!.label).toBe('Gemini 3.1 Flash (recommended)');
    expect(list[2]!.label).toBe('Gemini 3.1 Pro (most capable, costs more)');
  });
});
