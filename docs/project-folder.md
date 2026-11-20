# Budget project folders

Each budget is a folder, by default under `Documents/Fringe Budgets`. A folder is complete on its
own: copy it, back it up or move it, and open it again with Open Project.

`Fringe Budgets/instructions.md` holds the user's instructions for the AI for every budget (house
rules, rate sources). The Knowledge screen opens it; it's made the first time.

```
My Show/
  project.json            format, schema version, project id, name, created, engine version
  budget.json             the main line as it is now: plain JSON, readable without the app
  branches/               each other branch as it is now, e.g. "25-day shoot.json", also plain JSON
  history/events.jsonl    every change, undo, branch and version, one JSON line each, oldest first
  history/objects/        content-addressed pieces of each snapshot (<sha256>.json)
  versions/               PDFs of saved versions, e.g. "My Show v1.0.pdf", "My Show - 25-day shoot v1.0.pdf"
  knowledge/              everything kept with the budget: rate sheets, contracts, deal memos, schedules
  knowledge/instructions.md   instructions and decisions for this production (read by the AI first)
  README.md
```

## Saving

Changes save as they happen (autosave). Each change to the budget adds one `change` line to
the event log; undo and redo add a `move` line naming the branch and the entry now at its end. A
change's snapshot is split into pieces (the outline, the settings, each account), each stored
once under the hash of its content, so an edit to one account stores that account and a new
outline.

A `change` line names its `parent` (the entry it was made from) and its `branch`. Undo goes to the
parent, and a change made after undoing replaces the undone ones on that branch; they stay in the
log, so nothing is ever dropped. Saving a
version adds a `version` line (number, name, date sent, sent to, notes, what changed, the entry it
points at and its PDF's file name); editing it adds another `version` line with the same id, and
deleting it adds a `version-deleted` line. The log is never pruned.

## Branches

A budget has a main line and any number of named branches, each started from a saved version
(older budgets may have branches started from the end of another branch). A `branch` line records a branch: its id, name, the entry it
starts from, when, and whether it's marked not picked. Renaming it or marking it adds another
`branch` line with the same id; the latest wins. A new id also shows that branch. Opening the end
of another branch adds a `show` line, so the project opens on the branch last worked on. Looking at
an earlier point writes nothing: it's read-only. The main line's id is `main`, and its name is the
budget's.

Each version line names its branch, and every branch numbers its own versions from v1.0.
A version's PDF is named after the budget, its branch (not for the main line) and its number, so
two branches never share a file.

Copy to new budget makes a separate project folder from any point. Its `budget.json` keeps a
`forkedFrom` field (the budget's id and name, the entry and when), the name from before branches.

Order of writes, so a crash never leaves a line pointing at a missing piece:

1. new pieces, each written in full to a temporary file, flushed and renamed;
2. the event lines, appended and flushed;
3. `budget.json` (the main line), written the same way as pieces;
4. the files in `branches/` for branches whose end changed, the same way. Files of renamed
   branches are removed.

## Opening

The app replays the whole event log into the history (every entry, including undone branches)
and shows the end of the branch last worked on. A change line without `parent` (an older save) takes the entry
that was showing when it was made. A log from before branches is sorted into them: the line to
the entry that was showing is the main line, and each other line with a saved version on it becomes
"Alternate 1", "Alternate 2"… (in the order they started), running to the newest change after the
version. Branch ids come from the entries, so the same log always sorts the same way. Lines that don't parse are skipped. If the log can't be replayed at all, the app opens
`budget.json`, starts a new history from it and says so.

The app only saves to folders it created or opened in this session.

## .fringe files

A `.fringe` file is one project in a single file, for sending or backing up. It's a plain ZIP of the
project folder: `project.json`, `budget.json`, `README.md`, `branches/`, `history/`, `versions/` and `knowledge/`. Any unzip
tool opens it, and a project folder zipped by hand opens in Fringe too.

- **Export…** (status bar) saves the open budget once it's saved, history and files included.
  Those files can be confidential, so it's the user's call who gets it.
- **Import Budget…** (start page, Ctrl+I), or double-clicking one in the installed app, unpacks it into
  a new folder in Fringe Budgets (with "(2)" if the name is taken) and opens it. The `.fringe` file
  itself is never changed.
- Opening only keeps the project's own files, refuses paths that could land outside the folder,
  and caps the size (1 GB file, 2 GB unpacked). It unpacks into a temporary folder first, so a
  damaged file leaves nothing behind.
