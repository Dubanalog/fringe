# Budget project folders

Each budget is a folder, by default under `Documents/Fringe Budgets`. A folder is complete on its
own: copy it, back it up or move it, and open it again with Open Project.

`Fringe Budgets/instructions.md` holds the user's instructions for the AI for every budget (house
rules, rate sources). The Knowledge screen opens it; it's made the first time.

```
My Show/
  project.json            format, schema version, project id, name, created, engine version
  budget.json             the budget as it is now: plain JSON, readable without the app
  history/events.jsonl    every change, undo and go-back, one JSON line each, oldest first
  history/objects/        content-addressed pieces of each snapshot (<sha256>.json)
  versions/               PDFs of saved versions, e.g. "My Show v1.0.pdf"
  knowledge/              everything kept with the budget: rate sheets, contracts, deal memos, schedules
  knowledge/instructions.md   instructions and decisions for this production (read by the AI first)
  README.md
```

## Saving

Changes save as they happen (autosave). Each change to the budget adds one `change` line to
the event log; undo, redo and going back add a `move` line naming the entry now showing. A
change's snapshot is split into pieces (the outline, the settings, each account), each stored
once under the hash of its content, so an edit to one account stores that account and a new
outline.

A `change` line names its `parent`: the entry it was made from. Undo goes to the parent, so a
change made after undoing starts a branch and nothing is ever replaced or dropped. Saving a
version adds a `version` line (number, name, date sent, sent to, notes, what changed, the entry it
points at and its PDF's file name); editing it adds another `version` line with the same id, and
deleting it adds a `version-deleted` line. The log is never pruned.

Order of writes, so a crash never leaves a line pointing at a missing piece:

1. new pieces, each written in full to a temporary file, flushed and renamed;
2. the event lines, appended and flushed;
3. `budget.json`, written the same way as pieces.

## Opening

The app replays the whole event log into the history (every entry, including undone branches)
and shows the entry the log ends on. A change line without `parent` (an older save) takes the entry
that was showing when it was made. Lines that don't parse are skipped. If the log can't be replayed at all, the app opens
`budget.json`, starts a new history from it and says so.

The app only saves to folders it created or opened in this session.

## .fringe files

A `.fringe` file is one project in a single file, for sending or backing up. It's a plain ZIP of the
project folder: `project.json`, `budget.json`, `README.md`, `history/`, `versions/` and `knowledge/`. Any unzip
tool opens it, and a project folder zipped by hand opens in Fringe too.

- **Export…** (status bar) saves the open budget once it's saved, history and files included.
  Those files can be confidential, so it's the user's call who gets it.
- **Import Budget…** (start page, Ctrl+I), or double-clicking one in the installed app, unpacks it into
  a new folder in Fringe Budgets (with "(2)" if the name is taken) and opens it. The `.fringe` file
  itself is never changed.
- Opening only keeps the project's own files, refuses paths that could land outside the folder,
  and caps the size (1 GB file, 2 GB unpacked). It unpacks into a temporary folder first, so a
  damaged file leaves nothing behind.
