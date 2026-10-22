# Building add-ons

The guide the AI gets (from `list_addons`) before it builds or changes an add-on. The app's side is
`apps/desktop/src/main/addons.ts` (storage, the locked-down page, `window.fringe`) and
`apps/desktop/src/renderer/src/addons/` (the frame and its messages).

---

An add-on is a page the user asks you to build on top of Fringe: a cash flow, a hiring plan, a
deal-memo tracker, a cost report, a chart. It's kept with the app, not with a budget, so it works
on whichever budget is showing, and the user opens it from **Add-ons** in the sidebar.

## What you write

One self-contained HTML file: its own `<style>` and `<script>`, no other files. Give it a
`<title>`.

It runs locked down:

- **No network.** No CDN scripts, fonts, images from the web or `fetch`: they're blocked. Write
  everything inline. Pictures and fonts can be `data:` URLs.
- No files, no popups, no forms that submit, no `localStorage` (it's not kept). Keep state with
  `fringe.saveData`.
- It can't change the budget's lines. It reads the budget and keeps its own data in it. When the
  user wants the budget itself changed, they ask you, and you use the budget tools.

## `window.fringe`

Ready before your script runs. Every call returns a promise.

- `fringe.budget()` → `{ budget, totals }`, or `null` when no budget is open (show a short
  "Open a budget to use …" message).
- `fringe.onBudgetChange(f)` → `f({ budget, totals })` (or `f(null)`) whenever the budget changes
  or another one is shown. Re-draw from it; don't keep stale copies.
- `fringe.data()` → what this add-on saved in this budget, or `null` the first time.
- `fringe.saveData(value, label)` saves it (any JSON, up to 2 MB) in the budget, under the
  add-on's id. `label` is the history entry, e.g. `"Cash flow: camera over weeks 3–10"`. It's one
  step in the budget's history, so the user can undo it; `onBudgetChange` fires after. Save when
  the user changes something, not on every keystroke (wait until they leave the field).
- `fringe.saveReport(report, 'pdf' | 'xlsx', landscape?)` asks the user where, and saves a
  report in the app's own report style. `report` is `{ title, sections: [{ title, columns, rows,
totals?, note? }] }`. `title` is the report's own name, e.g. `"Cash Flow"`: the app adds the
  budget's name. `columns` are `{ label, kind }`, `kind` being `'text'` (the default), `'money'`,
  `'number'` or `'percent'`. `rows` is a list of rows and `totals` a list of total rows, each row a
  list of cells: `rows: [['1100', 'Writers', 25000]], totals: [['', 'Total', 25000]]`. Cells are
  strings or numbers; money as plain numbers and percentages as `45.5` for 45.5% (the report
  formats and rounds them). Resolves to the file saved, or `null` if they cancelled.
- `fringe.askClaude(text)` opens the AI panel with `text` ready to send, e.g. a "Ask Claude to
  fill this in" button. The user sends it.
- `fringe.onThemeChange(f)`: the app's colours change. You don't need it if you use the CSS
  variables below.

### The budget

All amounts are strings (exact decimals, e.g. `"12500.00"`): use `Number()` for display maths,
and keep them as strings in anything you save.

- `budget.name`, `budget.settings.title`.
- `budget.categories[]`: `{ id, number, description, accounts[] }`.
- `account`: `{ id, number, description, details[] }`.
- `detail` (a line): `{ id, description, amount, unit, x, rate, subtotal, fringes: [names],
groups: [names], location, set }`.
- `budget.settings`: `fringeDefs` (`{ name, kind, rate, cutoff }`), `groups`, `globals`,
  `percentages`, `incentives`, `coa.levels` (production levels, e.g. Above-The-Line, by number
  range).
- `totals.grand.total`, `totals.net`, `totals.categories[categoryId]`,
  `totals.accounts[accountId]` (each `{ total, fringe, original, variance }`),
  `totals.lines[lineId]` (`{ subtotal, fringe }`), `totals.percentages`, `totals.incentives`.

Key what you save by ids (account and line ids stay the same when the user renames or renumbers),
and cope with ids that are gone (deleted accounts).

## How it should look

It sits inside Fringe, so match it. The app sets these CSS variables on your page, following the
user's theme: `--bg`, `--surface`, `--surface-alt`, `--hover`, `--border`, `--text`,
`--text-muted`, `--accent`, `--accent-text`, `--positive`, `--negative`, `--focus`. Use them for
every colour, with `body { background: var(--bg); color: var(--text); }`, and the system font
(`font: 14px system-ui, sans-serif`). Money right-aligned with tabular figures
(`font-variant-numeric: tabular-nums`), thousands separators, no currency symbol on every cell.

The people using it are production accountants, not programmers: plain words, no jargon, a
clear heading, and a sentence saying what the page does. Spreadsheet conventions for anything
grid-like (Tab and Enter move between cells, typing replaces the value).

## Saving it

`save_addon` with `name`, `description` (one sentence for the list), `aboutData` (what it saves
with `saveData`, its shape and meaning, so you or another AI can read and fill it in later with
`get_addon_data` and `set_addon_data`) and `html`. Pass the `addon` id to change an existing one
(read it first with `read_addon`, and keep what the user liked). The user allows each save. Then
`open_addon` shows it.

Build the simplest thing that does what was asked, and say what it does and what it doesn't.
