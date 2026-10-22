import { calculateTotals } from './calc';
import { compareBudgets, describeComparison } from './compare';
import {
  type BudgetHistory,
  type BudgetVersion,
  VersionError,
  changesBetween,
  currentBudget,
  findVersion,
  nextVersionNumber,
  previousVersion,
  saveVersion,
  versionBudget,
  versionsNewestFirst,
} from './history';
import { ToolError, obj, str, text } from './tool-kit';

/**
 * Tools for the budget's saved versions (History tab). They work on the whole history, not just the
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
  /** Fields for the History tab's "Save version" form, for the user to check and save. */
  draft?: VersionDraft;
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

function versionNamed(history: BudgetHistory, number: string): BudgetVersion {
  const v = findVersion(history, number);
  if (!v) {
    const have = versionsNewestFirst(history.versions).map((x) => `v${x.number}`);
    throw new ToolError(
      have.length > 0
        ? `There's no v${number}. The versions are ${have.join(', ')}.`
        : 'This budget has no versions yet. The user saves them on the History tab.',
    );
  }
  return v;
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
      'Lists the budget\'s saved versions, newest first: the numbered copies the user sent out (v1.0, v1.1…), with when and to whom they were sent, notes, the "What changed" text and the grand total at that version.',
    inputSchema: obj({}),
    edits: false,
    run: (history) => ({
      result: {
        versions: versionsNewestFirst(history.versions).map((v) => summary(history, v)),
        grandTotalNow: calculateTotals(currentBudget(history)).grand.total,
      },
    }),
  },
  {
    name: 'compare_versions',
    description:
      "Compares two points in the budget's history, worked out by the app from the saved versions: every category and account whose total changed, the topsheet totals (percentages, grand total, incentives, net cost), every other difference (settings, percentages, fringes, descriptions…), and the changes made in between as the History tab lists them. `from` is a version number, or left out for the latest; `to` is a version number or left out for the budget now. Use this, never figures from imported files or assumptions, to say what changed between versions. `draft` is a plain-text summary to start from.",
    inputSchema: obj({
      from: str('The earlier version, e.g. "1.0"; leave out for the latest version.'),
      to: str('The later version, e.g. "1.1"; leave out for the budget as it is now.'),
    }),
    edits: false,
    run: (history, input) => {
      const fromNumber = typeof input['from'] === 'string' ? input['from'].trim() : '';
      const latest = versionsNewestFirst(history.versions)[0];
      if (!fromNumber && !latest) versionNamed(history, '');
      const from = fromNumber ? versionNamed(history, fromNumber) : latest!;
      const toNumber = typeof input['to'] === 'string' && input['to'].trim() ? input['to'] : null;
      const to = toNumber ? versionNamed(history, toNumber) : null;
      const before = versionBudget(history, from);
      const afterEntry = to ? to.entryId : history.entries[history.current]!.id;
      const after = to ? versionBudget(history, to) : currentBudget(history);
      if (!before || !after) throw new ToolError('That version is no longer in the history.');
      const c = compareBudgets(before, after);
      const steps = changesBetween(history, from.entryId, afterEntry);
      return {
        result: {
          from: `v${from.number}`,
          to: to ? `v${to.number}` : 'now',
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
      'Changes a saved version\'s details on the History tab (for a version not saved yet, use fill_version_form). Write a version\'s "What changed" here (whatChanged), never in the assumptions. Only the fields given change. Use compare_versions with the version before it first, so the text is right.',
    inputSchema: obj(
      {
        version: str('Which version, e.g. "1.1".'),
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
      const was = versionNamed(history, text(input, 'version'));
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
      'Fills in the History tab\'s "Save version" form for a new version of the budget as it is now, opening it if it isn\'t open, for the user to check and save. Use it when the user is about to save a version: write "What changed" (whatChanged) from compare_versions against the latest version. Only the fields given are filled; whatChanged replaces what\'s in that box. Nothing is saved until the user clicks Save version.',
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
      const latest = versionsNewestFirst(history.versions)[0];
      return {
        draft,
        result: {
          filledIn: Object.keys(draft),
          version: draft.number ?? nextVersionNumber(history.versions),
          comparedWith: latest ? `v${latest.number}` : null,
          note: 'The form is filled in on the History tab. The user checks it and clicks Save version.',
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
