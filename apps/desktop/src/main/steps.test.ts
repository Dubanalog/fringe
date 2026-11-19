import { describe, expect, it } from 'vitest';
import { describeTool } from './steps';

describe('step labels', () => {
  it("names the user's files", () => {
    expect(describeTool('Read', { file_path: 'C:\\B\\Pilot\\knowledge\\COA.xml' })).toBe('Read COA.xml');
  });

  it("hides Claude Code's saved tool output behind a plain label", () => {
    for (const file_path of [
      'C:\\Users\\a\\.claude\\projects\\x\\abc\\tool-results\\toolu_015GxRyuyetvYmyQgkdL2tFH.txt',
      '/home/a/.claude/projects/x/tool-results/result.json',
      'toolu_01ABC.txt',
    ])
      expect(describeTool('Read', { file_path })).toBe('Read the rest of the search results');
  });
});
