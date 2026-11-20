import { calculateTotals } from './calc';
import { compareBudgets, describeComparison } from './compare';
import {
  type Branch,
  BranchError,
  type BudgetHistory,
  type BudgetVersion,
  MAIN_BRANCH,
  VersionError,
  activeBranch,
  branchName,
  canBranchFrom,
  changesBetween,
  createBranch,
  currentBudget,
  findBranch,
  findEntry,
  findVersion,
  isEditable,
  nextVersionNumber,
  previousVersion,
  saveVersion,
  versionBudget,
  versionsNewestFirst,
  versionsOn,
} from './history';
import { ToolError, obj, str, text } from './tool-kit';

/**
 * Tools for the budget's saved versions (the Versions page). They work on the whole history, not just the
 * budget as it is, so the app runs them apart from the budget tools.
 */
export interface VersionTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  edits: boolean;
  run(history: BudgetHistory, input: Record<string, unknown>): VersionToolOutcome;
}

export interface VersionToolOutcome {
  result: unknown;
  /** A version changed, to save. */
  version?: BudgetVersion;
  label?: string;
  /** Fields for the Versions page's "Save version" form, for the user to check and save. */
  draft?: VersionDraft;
  /** A branch to start, and show, once the user allows it. */
  branch?: { name: string; fromEntryId: string };
}

/** What the AI fills in on the "Save version" form; only the fields given. */
export interface VersionDraft {
  number?: string;
  name?: string;
  sentOn?: string;
  sentTo?: string;
  notes?: string;
  whatChanged?: string;
}

const DRAFT_FIELDS = ['number', 'name', 'sentOn', 'sentTo', 'notes', 'whatChanged'] as const;

/** Most entries listed in a comparison's history and change details. */
const MAX_LISTED = 300;

/** A branch's name as the user sees it: its own, or the budget's for the main line. */
const labelOf = (history: BudgetHistory, branch: Branch) => branchName(branch, currentBudget(history).name);

/** The branch the AI named (by its name, or the budget's for the main line); the one showing when left out. */
function branchCalled(history: BudgetHistory, name: unknown): Branch {
  if (typeof name !== 'string' || !name.trim()) return activeBranch(history);
  const want = name.replace(/\s+/g, ' ').trim().toLowerCase();
  const found = history.branches.find((b) =>
    b.id === MAIN_BRANCH
      ? want === 'main' || want === labelOf(history, b).toLowerCase()
      : b.name.toLowerCase() === want,
  );
  if (found) return found;
  const names = history.branches.map((b) => `"${labelOf(history, b)}"`).join(', ');
  throw new ToolError(`There's no branch called "${name.trim()}". The branches are ${names}.`);
}

function versionNamed(history: BudgetHistory, number: string, branch = activeBranch(history)): BudgetVersion {
  const v = findVersion(history, number, branch.id);
  if (!v) {
    const have = versionsNewestFirst(versionsOn(history, branch.id)).map((x) => `v${x.number}`);
    const on = history.branches.length > 1 ? ` on "${labelOf(history, branch)}"` : '';
    throw new ToolError(
      have.length > 0
        ? `There's no v${number}${on}. Its versions are ${have.join(', ')}.`
        : `There are no versions${on} yet. The user saves them on the Versions page.`,
    );
  }
  return v;
}

/** A point named for the AI: "v1.1", or with its branch when the budget has more than one. */
function pointName(history: BudgetHistory, branch: Branch, what: string): string {
  return history.branches.length > 1 ? `${labelOf(history, branch)} ${what}` : what;
}

/** Where a branch started, e.g. "Pilot v1.0"; null for the main line. */
function startedFrom(history: BudgetHistory, branch: Branch): string | null {
  const from = branch.from ? findEntry(history, branch.from) : null;
  if (!from) return null;
  const on = findBranch(history, from.branch) ?? history.branches[0]!;
  const v = versionsOn(history, on.id).find((x) => x.entryId === from.id);
  return `${labelOf(history, on)} ${v ? `v${v.number}` : `as it was ${from.at}`}`;
}

/**
 * Why the AI can't change the budget showing, or null when it can: it shows a version or an
 * earlier point, which stays as it was.
 */
export function readOnlyNote(history: BudgetHistory): string | null {
  if (isEditable(history)) return null;
  const branch = activeBranch(history);
  const entry = history.entries[history.current];
  const v = entry ? versionsOn(history).find((x) => x.entryId === entry.id) : undefined;
  const here = `"${labelOf(history, branch)}" ${v ? `v${v.number}` : 'at an earlier point'}`;
  const start =
    entry && canBranchFrom(history, entry.id)
      ? 'To change it, start a branch from it with create_branch (ask the user for its name), or '
      : 'To change the budget, ';
  return `The user is looking at ${here}, which stays as it was. Nothing was changed. ${start}ask the user to click "Back to latest".`;
}

const summary = (history: BudgetHistory, v: BudgetVersion) => {
  const budget = versionBudget(history, v);
  return {
    version: v.number,
    name: v.name,
    savedAt: v.savedAt,
    sentOn: v.sentOn,
    sentTo: v.sentTo,
    notes: v.notes,
    whatChanged: v.changes,
    pdf: v.pdf,
    grandTotal: budget ? calculateTotals(budget).grand.total : null,
  };
};

export const VERSION_TOOLS: readonly VersionTool[] = [
  {
    name: 'list_versions',
    description:
      'Lists one branch\'s saved versions, newest first: the numbered copies the user sent out (v1.0, v1.1…), with when and to whom they were sent, notes, the "What changed" text and the grand total at that version. Each branch numbers its own versions from v1.0, so a number means something only with its branch. `branch` is a name from list_branches; leave it out for the branch showing.',
    inputSchema: obj({
      branch: str('The branch, as list_branches names it; leave out for the branch showing.'),
    }),
    edits: false,
    run: (history, input) => {
      const branch = branchCalled(history, input['branch']);
      const end = findEntry(history, branch.head);
      return {
        result: {
          branch: labelOf(history, branch),
          versions: versionsNewestFirst(versionsOn(history, branch.id)).map((v) => summary(history, v)),
          grandTotalLatest: end ? calculateTotals(end.budget).grand.total : null,
          ...(history.branches.length > 1
            ? { otherBranches: history.branches.filter((b) => b !== branch).map((b) => labelOf(history, b)) }
            : {}),
        },
      };
    },
  },
  {
    name: 'list_branches',
    description:
      "Lists the budget's branches: the main line (named after the budget) and the named lines started from a version or a branch's latest, e.g. \"25-day shoot\". Each has its own versions, numbered from v1.0. Gives where each started, its versions, its latest grand total, whether the user marked it not picked, and what the user is looking at now. Only a branch's latest can be changed; versions and earlier points stay as they were.",
    inputSchema: obj({}),
    edits: false,
    run: (history) => {
      const showing = activeBranch(history);
      const entry = history.entries[history.current];
      const atVersion = entry ? versionsOn(history).find((v) => v.entryId === entry.id) : undefined;
      return {
        result: {
          showing: {
            branch: labelOf(history, showing),
            point: isEditable(history) ? 'latest' : atVersion ? `v${atVersion.number}` : 'an earlier point',
            canChange: isEditable(history),
          },
          branches: history.branches.map((b) => {
            const end = findEntry(history, b.head);
            const versions = versionsNewestFirst(versionsOn(history, b.id));
            return {
              branch: labelOf(history, b),
              mainLine: b.id === MAIN_BRANCH,
              startedFrom: startedFrom(history, b),
              startedAt: b.id === MAIN_BRANCH ? null : b.createdAt,
              versions: versions.map((v) => `v${v.number}`),
              grandTotalLatest: end ? calculateTotals(end.budget).grand.total : null,
              notPicked: b.notPicked,
              showing: b === showing,
            };
          }),
        },
      };
    },
  },
  {
    name: 'create_branch',
    description:
      'Starts a named branch, a new line of the budget for a different plan (e.g. "25-day shoot"), from a saved version or a branch\'s latest, and shows it in the app, so your next changes go on it. The point it starts from stays as it was. Ask the user what to call it. `from` is a version number on `fromBranch` (the branch showing when left out); leave both out to start from what the user is looking at, or give only `fromBranch` to start from that branch\'s latest. The user allows it first.',
    inputSchema: obj(
      {
        name: str('The new branch\'s name, e.g. "25-day shoot".'),
        from: str('A version to start from, e.g. "1.0".'),
        fromBranch: str('The branch `from` is on, or whose latest to start from, as list_branches names it.'),
      },
      ['name'],
    ),
    edits: true,
    run: (history, input) => {
      const fromNumber = typeof input['from'] === 'string' ? input['from'].trim() : '';
      const hasBranch = typeof input['fromBranch'] === 'string' && input['fromBranch'].trim() !== '';
      const onBranch = branchCalled(history, input['fromBranch']);
      const entryId = fromNumber
        ? versionNamed(history, fromNumber, onBranch).entryId
        : hasBranch
          ? onBranch.head
          : history.entries[history.current]!.id;
      if (!canBranchFrom(history, entryId)) {
        throw new ToolError(
          "A branch starts from a saved version or a branch's latest, and the user is looking at an earlier point. Give `from` (a version) or `fromBranch`.",
        );
      }
      let made: ReturnType<typeof createBranch>;
      try {
        made = createBranch(history, text(input, 'name'), entryId);
      } catch (err) {
        if (err instanceof BranchError) throw new ToolError(err.message);
        throw err;
      }
      return {
        branch: { name: made.branch.name, fromEntryId: entryId },
        label: `AI: start branch "${made.branch.name}"`,
        result: {
          branch: made.branch.name,
          startedFrom: startedFrom(made.history, made.branch),
          note: 'The app now shows the new branch, and your changes go on it. Its versions are numbered from v1.0.',
        },
      };
    },
  },
  {
    name: 'compare_versions',
    description:
      "Compares two points in the budget's history, worked out by the app from the saved versions: every category and account whose total changed, the topsheet totals (percentages, grand total, incentives, net cost), every other difference (settings, percentages, fringes, descriptions…), and the changes made in between as the Versions page lists them. `from` is a version number on `fromBranch`, or left out for that branch's latest version; `to` is a version number on `toBranch`, or left out for what the user is looking at now (or `toBranch`'s latest, when given). Branches number their own versions, so to compare two branches give both branch names, e.g. from 1.0 on the main line to toBranch \"25-day shoot\". Leave the branches out for the branch showing. Use this, never figures from imported files or assumptions, to say what changed between versions. `draft` is a plain-text summary to start from.",
    inputSchema: obj({
      from: str('The earlier version, e.g. "1.0"; leave out for the latest version.'),
      fromBranch: str(
        'The branch `from` is on, as list_branches names it; leave out for the branch showing.',
      ),
      to: str('The later version, e.g. "1.1"; leave out for the budget as it is now.'),
      toBranch: str("The branch `to` is on; with no `to`, compares with that branch's latest."),
    }),
    edits: false,
    run: (history, input) => {
      const fromBranch = branchCalled(history, input['fromBranch']);
      const fromNumber = typeof input['from'] === 'string' ? input['from'].trim() : '';
      const latest = versionsNewestFirst(versionsOn(history, fromBranch.id))[0];
      if (!fromNumber && !latest) versionNamed(history, '', fromBranch);
      const from = fromNumber ? versionNamed(history, fromNumber, fromBranch) : latest!;
      const hasToBranch = typeof input['toBranch'] === 'string' && input['toBranch'].trim() !== '';
      const toBranch = branchCalled(history, input['toBranch']);
      const toNumber = typeof input['to'] === 'string' && input['to'].trim() ? input['to'] : null;
      const to = toNumber ? versionNamed(history, toNumber, toBranch) : null;
      const before = versionBudget(history, from);
      const afterEntry = to ? to.entryId : hasToBranch ? toBranch.head : history.entries[history.current]!.id;
      const after = findEntry(history, afterEntry)?.budget;
      if (!before || !after) throw new ToolError('That version is no longer in the history.');
      const c = compareBudgets(before, after);
      const steps = changesBetween(history, from.entryId, afterEntry);
      return {
        result: {
          from: pointName(history, fromBranch, `v${from.number}`),
          to: to
            ? pointName(history, toBranch, `v${to.number}`)
            : hasToBranch
              ? pointName(history, toBranch, 'latest')
              : 'now',
          totals: c.totals,
          categories: c.categories,
          otherChanges: c.details.slice(0, MAX_LISTED),
          ...(c.details.length > MAX_LISTED ? { otherChangesNotListed: c.details.length - MAX_LISTED } : {}),
          history: steps.slice(-MAX_LISTED).map((e) => ({ at: e.at, change: e.label })),
          ...(steps.length > MAX_LISTED ? { historyNotListed: steps.length - MAX_LISTED } : {}),
          draft: describeComparison(c, after.settings.displayPrecision),
        },
      };
    },
  },
  {
    name: 'update_version',
    description:
      'Changes a saved version\'s details on the Versions page (for a version not saved yet, use fill_version_form). Write a version\'s "What changed" here (whatChanged), never in the assumptions. Only the fields given change. Use compare_versions with the version before it first, so the text is right.',
    inputSchema: obj(
      {
        version: str('Which version, e.g. "1.1".'),
        branch: str('The branch it is on, as list_branches names it; leave out for the branch showing.'),
        whatChanged: str('What changed since the version before, as the user would send it.'),
        notes: str('Notes about the version.'),
        name: str('e.g. "Studio draft".'),
        sentTo: str('Who it was sent to.'),
        sentOn: str('The date it was sent, YYYY-MM-DD, or "" for not sent.'),
      },
      ['version'],
    ),
    edits: true,
    run: (history, input) => {
      const was = versionNamed(history, text(input, 'version'), branchCalled(history, input['branch']));
      const field = (key: string, fallback: string) =>
        typeof input[key] === 'string' ? (input[key] as string) : fallback;
      const sentOn = field('sentOn', was.sentOn).trim();
      if (sentOn && !/^\d{4}-\d{2}-\d{2}$/.test(sentOn))
        throw new ToolError('Give sentOn as YYYY-MM-DD, e.g. 2026-10-16.');
      try {
        const { version } = saveVersion(
          history,
          {
            id: was.id,
            number: was.number,
            name: field('name', was.name),
            sentOn,
            sentTo: field('sentTo', was.sentTo),
            notes: field('notes', was.notes),
            changes: field('whatChanged', was.changes),
            pdf: was.pdf,
          },
          was.savedAt,
        );
        const before = previousVersion(history, was);
        return {
          version,
          label: `AI: v${was.number} details`,
          result: { ...summary(history, version), comparedWith: before ? `v${before.number}` : null },
        };
      } catch (err) {
        if (err instanceof VersionError) throw new ToolError(err.message);
        throw err;
      }
    },
  },
  {
    name: 'fill_version_form',
    description:
      'Fills in the Versions page\'s "Save version" form for a new version of the budget as it is now, opening it if it isn\'t open, for the user to check and save. Use it when the user is about to save a version: write "What changed" (whatChanged) from compare_versions against the latest version. Only the fields given are filled; whatChanged replaces what\'s in that box. Nothing is saved until the user clicks Save version.',
    inputSchema: obj({
      whatChanged: str('What changed since the latest version, as the user would send it.'),
      notes: str('Notes about the version.'),
      name: str('e.g. "Studio draft".'),
      sentTo: str('Who it is being sent to.'),
      sentOn: str('The date it is sent, YYYY-MM-DD.'),
      number: str('The version number, e.g. "1.1"; leave out for the next one.'),
    }),
    edits: false,
    run: (history, input) => {
      const draft: VersionDraft = {};
      for (const key of DRAFT_FIELDS) {
        const v = input[key];
        if (typeof v === 'string') draft[key] = v;
      }
      if (draft.sentOn && !/^\d{4}-\d{2}-\d{2}$/.test(draft.sentOn.trim()))
        throw new ToolError('Give sentOn as YYYY-MM-DD, e.g. 2026-10-16.');
      if (draft.number !== undefined) {
        const n = draft.number.trim().replace(/^v/i, '');
        if (findVersion(history, n)) throw new ToolError(`There's already a v${n}.`);
      }
      if (Object.keys(draft).length === 0) throw new ToolError('Give at least one field to fill in.');
      const locked = readOnlyNote(history);
      if (locked) throw new ToolError(`A version is saved from a branch's latest. ${locked}`);
      const latest = versionsNewestFirst(versionsOn(history))[0];
      return {
        draft,
        result: {
          filledIn: Object.keys(draft),
          version: draft.number ?? nextVersionNumber(versionsOn(history)),
          comparedWith: latest ? `v${latest.number}` : null,
          note: 'The form is filled in on the Versions page. The user checks it and clicks Save version.',
        },
      };
    },
  },
];

/** Runs a version tool by name; null when it isn't one. */
export function runVersionTool(
  history: BudgetHistory,
  name: string,
  input: unknown,
): VersionToolOutcome | null {
  const tool = VERSION_TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  return tool.run(history, input && typeof input === 'object' ? (input as Record<string, unknown>) : {});
}
