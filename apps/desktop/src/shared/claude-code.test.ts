import { describe, expect, it } from 'vitest';
import { isClaudeCodeModel, slashCommandReply } from './claude-code';

describe("Claude Code's commands in the panel chat", () => {
  it('points /model to the Model setting', () => {
    expect(slashCommandReply('/model')).toMatch(/AI settings/);
    expect(slashCommandReply('  /Model opus ')).toMatch(/AI settings/);
  });

  it('answers other commands, and leaves ordinary messages alone', () => {
    expect(slashCommandReply('/clear')).toMatch(/New Chat/);
    expect(slashCommandReply('/cost')).toMatch(/\/cost/);
    expect(slashCommandReply('What is 1/2 of the fringe?')).toBeNull();
    expect(slashCommandReply('/ 2')).toBeNull();
  });

  it('knows the models it can ask for', () => {
    expect(isClaudeCodeModel('sonnet')).toBe(true);
    expect(isClaudeCodeModel('')).toBe(true);
    expect(isClaudeCodeModel('gpt-4')).toBe(false);
    expect(isClaudeCodeModel(undefined)).toBe(false);
  });
});
