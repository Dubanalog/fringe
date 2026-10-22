# AI connection (MCP)

Fringe runs a small MCP server so an AI app can read and edit the budgets open in the window.

- **Where:** `http://127.0.0.1:47615/mcp` (another port if that one is taken), Streamable HTTP, JSON
  responses. Nothing off this computer can reach it, and requests from web pages are refused.
- **Who:** every request needs `Authorization: Bearer <token>`. The token is in the app's data
  folder (`mcp-token`) made by Fringe (not from any account). The AI screen copies it in a command under Advanced, never shows it, and can replace it ("Make a New Token"), which cuts off apps holding the old one.
- **When:** off until the user turns it on (Assistant screen) or starts a chat in the AI panel.
- **What:** the tools in `packages/budget-engine/src/tools.ts` (reading and fixing an import) and
  `edit-tools.ts` (building and changing everything else: categories, accounts, lines, fringes,
  globals, units, groups, codes, numbering, options, report title and assumptions), and the `import_assistant` prompt
  (`docs/ai/import-assistant.md`). `version-tools.ts` reads and compares the saved versions
  (`list_versions`, `compare_versions`, worked out from the history like the version form's fill
  button) fills in the "Save version" form for the user to check and save (`fill_version_form`), and changes
  a saved version's details (`update_version`). Tool calls run in the window; edits go into the budget's
  history as "AI: …" and are saved.
- **Which budget:** every tool takes an optional `budget`; without it, it works on the budget
  showing. `list_budgets` lists the open budgets and recently opened ones that aren't open. Those
  can be read (from their `budget.json`) but not changed: edits only go to an open budget, through
  the window, so the user can allow and undo them. Each chat message starts with a note saying which
  budget is showing. The AI is told to look at another budget only when the user asks about it
  (`apps/desktop/src/main/ai-tools.ts`, `budget-choice.ts`).
- **Files:** `list_budget_files` and `read_budget_file` (in `apps/desktop/src/main/ai-tools.ts`)
  read a budget's `knowledge/` folder. Files added on the
  Knowledge screen, or with the panel's paperclip or by dropping them on the panel, are copied into
  `knowledge/`. `knowledge/instructions.md` holds standing instructions for that budget;
  `Fringe Budgets/instructions.md` holds them for every budget and goes into the system prompt.
  `update_instructions` adds to or rewrites either file. From the chat panel the user always
  allows it, seeing the text (History can't undo a file, so "Allow all" doesn't cover it).
  Other MCP apps write it straight away, as their budget edits go straight in.

## The AI panel

The titlebar's AI button (Ctrl+J) opens a chat panel on the right. The panel doesn't depend on any
one AI company: the user picks how it reaches an AI in the panel's settings (the sliders button),
either through an AI plan they already pay for, through an app that company provides, or with their
own API key. The same tools, system prompt and **Allow** cards are used whichever they pick.

### With an AI plan, through Claude Code

Today the plan option is Anthropic's Claude Code (a Claude Pro or Max plan); other companies' tools
can be added the same way. The panel runs the user's own Claude Code in the background
(`apps/desktop/src/main/chat.ts`):

```
claude -p --input-format stream-json --output-format stream-json --include-partial-messages
  --mcp-config <app data>/chat-mcp.json --strict-mcp-config --tools Read,Glob,Grep
  --allowedTools Read,Glob,Grep,mcp__fringe --permission-prompts none
  --append-system-prompt-file <app data>/chat-prompt.md [--resume <conversation>]
```

It starts in the budget's project folder. Claude Code's other tools (commands, writing files) are
switched off, and the user's other MCP servers aren't loaded. The panel shows Claude's answer as it
arrives and each step in plain words ("Looked at account 2100").

**Edits wait for the user.** The chat's MCP config sends `x-fringe-client: panel`; for those
requests an edit tool is shown in the panel as a card with **Allow** / **Don't Allow** before it
is applied, and Claude is told if the user says no.

When the panel opens it checks `claude auth status`. If Claude Code isn't installed, **Get Claude
Code** opens Anthropic's setup page in the browser (the app runs no installer itself), and **I've
Installed It** checks again; Fringe looks for `claude` on PATH and in `~/.local/bin`. If it isn't
signed in, **Sign In** runs `claude auth login --claudeai`
without a terminal: Claude Code opens Anthropic's sign-in page in the user's browser and finishes
by itself once they approve. If the page shows a code instead, the user pastes it into the panel,
which hands it to Claude Code. A message sent before signing in goes once they're signed in.

The terminal, from the panel's header (the `>_` button), is for people who prefer Claude Code
itself. It opens the user's shell in the projects folder and runs:

```
claude --mcp-config <app data>/claude-mcp.json --allowedTools <the reading tools>
```

The config files hold the server address and token for these runs only; the user's own Claude
Code settings are not changed. In the terminal, reading tools run without asking and Claude Code
asks the user before each edit. The user signs in to Claude Code with their own Claude plan. Fringe never sees that sign-in.

### With an API key: Anthropic, OpenAI or Google

The panel's settings can instead use the user's own API key from one of three companies, each billed by that company
(`apps/desktop/src/main/apichat.ts`, one adapter each in `apps/desktop/src/main/providers/`):

- **Anthropic** (console.anthropic.com): Claude, through the Messages API.
- **OpenAI** (platform.openai.com): GPT, through the Responses API, with `store: false`. A ChatGPT
  plan doesn't include API use.
- **Google** (aistudio.google.com): Gemini, through the Gemini API. It has a free allowance, but on
  it Google may use what's sent to improve its products; the settings say so.

A key is checked with its company, then kept encrypted with the system's keychain (Electron
`safeStorage`) in the app's data folder, one file per company; it never goes back to the window.
Fringe then calls that company's API (nowhere else) itself, with the same budget and file tools and
the same system prompt. Edits wait for **Allow** in the panel, as above. PDFs and pictures from the
budget's files go to the model as files. The OpenAI and Gemini model lists come from the company
(newest first, the recommended one at the top), since their names change often; Anthropic's are
fixed. The conversation lives in memory until **New Chat** or a switch of company.

Other MCP apps can connect with the command or details on the Assistant screen.
