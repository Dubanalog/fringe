/**
 * The models the panel's chat can ask Claude Code for, by Claude Code's own names for them
 * (`--model`), so they follow its newest version of each. Empty is Claude Code's own default.
 */
export const CLAUDE_CODE_MODELS: readonly { id: string; label: string }[] = [
  { id: '', label: "Claude Code's default" },
  { id: 'opus', label: 'Opus: the most capable' },
  { id: 'sonnet', label: 'Sonnet: quick and capable, goes further on your plan’s limits' },
  { id: 'haiku', label: 'Haiku: the quickest, for simple questions' },
];

export const isClaudeCodeModel = (id: unknown): id is string =>
  typeof id === 'string' && CLAUDE_CODE_MODELS.some((m) => m.id === id);

/**
 * What to say when a message is just a Claude Code command, like "/model": the panel runs Claude
 * Code without its terminal, where those commands don't work, so they'd reach Claude as words.
 * Null for anything else.
 */
export function slashCommandReply(text: string): string | null {
  const command = /^\/([a-z][\w-]*)(\s|$)/i.exec(text.trim())?.[1]?.toLowerCase();
  if (!command) return null;
  switch (command) {
    case 'model':
      return 'To change the model, open AI settings (the sliders button at the top of this panel) and pick one under Model.';
    case 'clear':
    case 'new':
      return 'To start over, use New Chat under the message box.';
    case 'login':
    case 'logout':
      return 'Sign in to Claude Code in its own terminal: open it with the terminal button at the top of this panel.';
    default:
      return `Commands like /${command} only work in Claude Code's terminal. Open it with the terminal button at the top of this panel.`;
  }
}
