# Developing Fringe

Requires Node.js 22.12+ (see `.nvmrc`).

```bash
npm install
npm run dev
```

If Electron fails to start with "Electron failed to install correctly", run its installer once:

```bash
node node_modules/electron/install.js
```

| Command         | What it does                             |
| --------------- | ---------------------------------------- |
| `npm run dev`   | Run the app with hot reload              |
| `npm test`      | Unit tests (Vitest)                      |
| `npm run check` | Lint, typecheck, test                    |
| `npm run build` | Production build into `apps/desktop/out` |
| `npm run dist`  | Build an installer for this machine      |

The renderer reloads as you edit; changes to the main process or preload need `npm run dev`
restarted.

## Layout

```
apps/desktop/            Electron app (main, preload, React renderer)
packages/budget-engine/  Pure calculation engine (no Electron, no I/O)
docs/                    User manual, project folder format and the AI guides
scripts/                 Build helpers (the manual's PDF)
```

- [Project folder format](project-folder.md): how a budget is stored on disk.
- [MCP server](ai/mcp.md) and [import assistant](ai/import-assistant.md): what the AI is told and
  the tools it has.

## The manual

The user manual is [manual.md](manual.md). To build its PDF (Electron prints it):

```bash
npx electron scripts/manual-pdf.mjs
```

It's written to `apps/desktop/release/Fringe-Manual.pdf`, and each release builds it too.

## Releases

Pushing a `v*` tag builds the installers for every platform on GitHub and attaches them to a
release (`.github/workflows/release.yml`). The Mac app is signed and notarized when the repository
has the `MAC_CERTIFICATE`, `MAC_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and
`APPLE_TEAM_ID` secrets; without them it gets an ad-hoc signature.
