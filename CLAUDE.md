# Fringe — Claude working notes

Fringe is a free, open-source (AGPL-3.0) desktop budgeting app for film and TV: Electron, React and
TypeScript. Budgets are folders of plain JSON, and the AI works on them through the app's MCP server.
The person building it is a production accountant, so ask about budgeting and payroll details
(fringes, union rules, hours) instead of guessing.

**This repository is public.** Everything in this file and every tracked file can be read by anyone.
Private notes go in `CLAUDE.local.md` (not tracked).

## Read first
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): setup, commands (`npm run dev`, `npm test`,
  `npm run check`), layout, releases.
- [docs/project-folder.md](docs/project-folder.md): how a budget is stored on disk.
- [docs/ai/mcp.md](docs/ai/mcp.md), [docs/ai/import-assistant.md](docs/ai/import-assistant.md),
  [docs/ai/addons.md](docs/ai/addons.md): what the AI is told and the tools it has.
- [docs/manual.md](docs/manual.md): the user manual. Update it when a feature changes.

## Rules
- **The engine stays pure.** `packages/budget-engine` has no Electron and no I/O.
- **No format-specific importers.** Budgets from other programs are converted by the AI, following
  `docs/ai/import-assistant.md`. Never add a parser for one program's file format. Keep the guide
  generic (patterns any budget has) and put new lessons into it.
- **Don't copy another program's interaction conventions** (shortcuts, navigation). Use browser,
  file-explorer and spreadsheet conventions instead.
- **The AI never handles a subscription sign-in.** Users bring their own Claude plan (through Claude
  Code and MCP) or an API key.
- **Never ship preset fringe rates.** The rate library starts empty. Rates come from the user's own
  budgets, their own typing or a shared file, each with an "as of" date and a source.
- **Test before clicking.** Check logic with unit tests first. Drive the real UI only for what tests
  can't cover (layout, drag, real input), with as few steps and screenshots as possible.
- Commit or push only when asked.
