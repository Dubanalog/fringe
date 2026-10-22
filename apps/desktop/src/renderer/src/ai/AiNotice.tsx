/**
 * Shown the first time the AI panel opens, before anything is sent: what the AI sees, where it
 * goes, and what to watch for. The main process won't start a chat or the terminal until it's
 * accepted.
 */
export function AiNotice({ onAccept, onClose }: { onAccept: () => void; onClose: () => void }) {
  return (
    <div className="ai-notice">
      <h3>Before you use AI in Fringe</h3>
      <dl>
        <dt>What it reads</dt>
        <dd>
          When you ask it something, the AI reads the budget: lines, rates, names, salaries, deals. It also
          reads the files you add for that budget.
        </dd>
        <dt>Where that goes</dt>
        <dd>
          It&apos;s sent over the internet to the AI company you choose (Anthropic for Claude, or OpenAI or
          Google with your own key), under your account and that company&apos;s terms. Nothing is sent until
          you ask. If the production has confidentiality rules or a studio AI policy, check them first.
        </dd>
        <dt>It can be wrong</dt>
        <dd>
          Check its numbers before you rely on them. It asks you before it changes a budget, and every change
          is in History, to undo.
        </dd>
        <dt>Files from other people</dt>
        <dd>
          A budget, file or add-on someone sends you can hide instructions meant to steer the AI. Read what it
          asks to change before you allow it.
        </dd>
        <dt>The Claude Code terminal</dt>
        <dd>
          The terminal runs Claude Code itself, with the permissions you give it on this computer, not just
          Fringe&apos;s. Use it if you already know Claude Code.
        </dd>
      </dl>
      <div className="actions actions-left">
        <button type="button" className="btn btn-primary" onClick={onAccept}>
          I Understand
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Not Now
        </button>
      </div>
    </div>
  );
}
