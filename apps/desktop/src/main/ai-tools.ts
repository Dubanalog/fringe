import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BUDGET_TOOLS, type Budget, VERSION_TOOLS, normalizeBudget } from '@fringe/budget-engine';
import {
  APPROVE_CALL,
  type ApprovalRequest,
  OPEN_ADDON_CALL,
  type OpenBudget,
  type ToolReply,
} from '../shared/ipc';
import addonGuide from '../../../../docs/ai/addons.md?raw';
import { type AddonDraft, addonIdForDraft, addonProblem, listAddons, readAddon, saveAddon } from './addons';
import { type BudgetChoice, budgetChoices, findBudget } from './budget-choice';
import { fileText } from './file-text';
import { budgetFilePath, listBudgetFiles } from './knowledge';
import { isOpenProject, projectsRoot, recentProjects, writeAtomic } from './projects';

/**
 * What the AI works on: any budget open in the window (one is showing), and recently opened
 * budgets that aren't open, which it can read but not change. Every tool takes an optional
 * `budget`, named as list_budgets names it; without one it works on the budget showing. Changes
 * only ever go to an open budget, through the window, so they land in its history and the user
 * can allow and undo them.
 */

/** Tools the app runs itself, served next to the budget tools. */
export interface AppTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(input: Record<string, unknown>): Promise<unknown>;
}

/** Runs a budget tool in the window, on a tab (null: the budget showing). */
export type WindowCaller = (
  name: string,
  input: Record<string, unknown>,
  options: { confirm: boolean; tab: string | null },
) => Promise<ToolReply>;

let open: OpenBudget[] = [];

/** The window's open budgets, checked: a project folder must be one the app opened. */
export function setOpenBudgets(list: unknown): void {
  if (!Array.isArray(list)) return;
  open = list.flatMap((b: Partial<OpenBudget>) =>
    b && typeof b.tab === 'string' && typeof b.name === 'string'
      ? [
          {
            tab: b.tab,
            name: b.name,
            project: isOpenProject(b.project) ? b.project : null,
            showing: b.showing === true,
          },
        ]
      : [],
  );
}

export async function allBudgets(): Promise<BudgetChoice[]> {
  const recent = (await recentProjects()).filter((r) => !r.missing);
  return budgetChoices(open, recent);
}

/** The folder of the budget a tool call names (or the one showing). */
export async function projectFor(input: Record<string, unknown>): Promise<string> {
  const choice = findBudget(await allBudgets(), input['budget']);
  if (!choice.project) throw new Error(`"${choice.label}" isn't saved in a folder yet, so it has no files.`);
  return choice.project;
}

const instructionsFile = () => join(projectsRoot(), 'instructions.md');
const INSTRUCTIONS_START =
  '# Instructions for all budgets\n\nWrite here anything the AI should know for every budget: house rules, where your rates come from, how you like budgets set up.\n';

/** The user's instructions for every budget; null when they haven't written any. */
export async function instructionsForAll(): Promise<string | null> {
  const text = await readFile(instructionsFile(), 'utf8').catch(() => '');
  const written = text.replace(INSTRUCTIONS_START, '').trim();
  return written === '' || /^(#.*\s*)*$/.test(written) ? null : text.trim();
}

/** The instructions file for every budget, made with a short note the first time. */
export async function allInstructionsPath(): Promise<string> {
  const path = instructionsFile();
  if (!(await stat(path).catch(() => null))) {
    await mkdir(projectsRoot(), { recursive: true });
    await writeFile(path, INSTRUCTIONS_START, { encoding: 'utf8', flag: 'wx' }).catch(() => undefined);
  }
  return path;
}

/** Said with each message, so the AI knows which budget the user is looking at. */
export function chatContext(): string {
  const showing = open.find((b) => b.showing);
  const others = open.filter((b) => !b.showing).map((b) => `"${b.name}"`);
  const also = others.length ? ` Also open: ${others.join(', ')}.` : '';
  return showing
    ? `(From Fringe, not typed by the user: the budget showing is "${showing.name}".${also})`
    : `(From Fringe, not typed by the user: no budget is showing.${also})`;
}

/** The project folders of every budget the AI can see, for Claude Code's file reading. */
export async function budgetFolders(): Promise<string[]> {
  return [...new Set((await allBudgets()).flatMap((b) => (b.project ? [b.project] : [])))];
}

const BUDGET_PARAM = {
  type: 'string',
  description:
    'Which budget, named as list_budgets gives it. Leave it out for the budget showing in the app.',
};

function withBudget(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = (schema['properties'] as Record<string, unknown> | undefined) ?? {};
  return { ...schema, type: 'object', properties: { ...properties, budget: BUDGET_PARAM } };
}

const asInput = (input: unknown): Record<string, unknown> =>
  typeof input === 'object' && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};

async function readSavedBudget(project: string): Promise<Budget> {
  return normalizeBudget(JSON.parse(await readFile(join(project, 'budget.json'), 'utf8')) as Budget);
}

const INSTRUCTIONS_TOOL = {
  name: 'update_instructions',
  description:
    'Adds to or rewrites the user\'s standing instructions for the AI: a budget\'s knowledge/instructions.md (for: "budget", the default; the one showing unless you name another), or the instructions for all budgets (for: "all"). Use it when the user asks you to remember something or to always do something a certain way. Say what you\'ll write first; the user allows each change in the chat panel. `add` adds text at the end; `replaceWith` rewrites the whole file (read it first, and keep what the user wrote).',
  inputSchema: {
    type: 'object',
    properties: {
      for: { type: 'string', enum: ['budget', 'all'], description: '"budget" (default) or "all" budgets.' },
      add: { type: 'string', description: 'Markdown to add at the end.' },
      replaceWith: { type: 'string', description: 'The whole new file, in place of what is there.' },
    },
  },
};

/** Changes an instructions file, with the user's OK from the panel when `confirm`. */
async function updateInstructions(
  input: Record<string, unknown>,
  confirm: boolean,
  callWindow: WindowCaller,
): Promise<ToolReply> {
  const forAll = input['for'] === 'all';
  const add = typeof input['add'] === 'string' ? input['add'].trim() : '';
  const replaceWith = typeof input['replaceWith'] === 'string' ? input['replaceWith'] : null;
  if (!add && replaceWith === null) return { ok: false, error: 'Give `add` or `replaceWith`.' };
  let path: string;
  let whose: string;
  if (forAll) {
    path = await allInstructionsPath();
    whose = 'the instructions for all budgets';
  } else {
    const choice = findBudget(await allBudgets(), input['budget']);
    if (!choice.project)
      return {
        ok: false,
        error: `"${choice.label}" isn't saved in a folder yet, so it has no instructions file.`,
      };
    path = join(choice.project, 'knowledge', 'instructions.md');
    whose = `the instructions for ${choice.label}`;
  }
  const before = await readFile(path, 'utf8').catch(() => '');
  const after =
    replaceWith !== null
      ? `${replaceWith.trimEnd()}
`
      : `${before.trimEnd()}

${add}
`;
  if (after === before) return { ok: true, result: { unchanged: true } };
  if (confirm) {
    const request: ApprovalRequest = {
      budget: 'your instructions',
      text: replaceWith !== null ? `Rewrite ${whose} as:` : `Add to ${whose}:`,
      detail: replaceWith !== null ? after.trim() : add,
    };
    const reply = await callWindow(APPROVE_CALL, { ...request }, { confirm: true, tab: null });
    if (!reply.ok) return reply;
    if ((reply.result as { allowed?: boolean } | undefined)?.allowed !== true)
      return { ok: false, error: "The user didn't allow this change. Ask what they'd like instead." };
  }
  await mkdir(dirname(path), { recursive: true });
  await writeAtomic(path, after);
  return {
    ok: true,
    result: {
      file: forAll ? 'instructions for all budgets' : 'knowledge/instructions.md',
      instructions: after,
    },
  };
}

const ADDON_TOOLS = [
  {
    name: 'save_addon',
    description:
      'Adds an add-on to the app, or changes one: a page on top of Fringe (a cash flow, a hiring plan, a cost report…) that works on any budget. Read the guide from list_addons first. Pass `addon` to change an existing one (read it first with read_addon); leave it out for a new one. The user allows each save.',
    inputSchema: {
      type: 'object',
      properties: {
        addon: { type: 'string', description: 'The id of the add-on to change; leave out for a new one.' },
        name: { type: 'string', description: 'Its name in the sidebar, e.g. "Cash Flow".' },
        description: { type: 'string', description: 'One sentence on what it does, for the add-ons list.' },
        aboutData: {
          type: 'string',
          description:
            'What it keeps with fringe.saveData: the shape and what each part means, so get_addon_data and set_addon_data can be used on it later.',
        },
        html: { type: 'string', description: 'The whole page: one self-contained HTML file.' },
      },
      required: ['name', 'description', 'html'],
    },
  },
  {
    name: 'open_addon',
    description: 'Shows an add-on in the app, e.g. after saving it, or to show the user what you changed.',
    inputSchema: {
      type: 'object',
      properties: { addon: { type: 'string', description: 'The add-on’s id, from list_addons.' } },
      required: ['addon'],
    },
  },
] as const;

const asText = (v: unknown) => (typeof v === 'string' ? v : '');

/** Saves an add-on, with the user's OK from the panel when `confirm`. */
async function saveAddonTool(
  input: Record<string, unknown>,
  confirm: boolean,
  callWindow: WindowCaller,
): Promise<ToolReply> {
  const draft: AddonDraft = {
    ...(input['addon'] !== undefined && input['addon'] !== null && { id: asText(input['addon']) }),
    name: asText(input['name']),
    description: asText(input['description']),
    ...(typeof input['aboutData'] === 'string' && { aboutData: input['aboutData'] }),
    html: asText(input['html']),
  };
  const problem = addonProblem(draft);
  if (problem) return { ok: false, error: problem };
  const before = draft.id ? await readAddon(draft.id) : null;
  if (draft.id && !before) return { ok: false, error: `There's no add-on "${draft.id}". Use list_addons.` };
  if (confirm) {
    const request: ApprovalRequest = {
      budget: 'your add-ons',
      text: before
        ? `Change the add-on "${before.info.name}"${draft.name.trim() !== before.info.name ? ` (now "${draft.name.trim()}")` : ''}: ${draft.description.trim()}`
        : `Add the add-on "${draft.name.trim()}": ${draft.description.trim()}`,
    };
    const reply = await callWindow(APPROVE_CALL, { ...request }, { confirm: true, tab: null });
    if (!reply.ok) return reply;
    if ((reply.result as { allowed?: boolean } | undefined)?.allowed !== true)
      return { ok: false, error: "The user didn't allow this. Ask what they'd like instead." };
  }
  const saved = await saveAddon(await addonIdForDraft(draft), draft);
  return {
    ok: true,
    result: { addon: saved.id, name: saved.name, version: saved.version, next: 'open_addon shows it.' },
  };
}

/** Sends a budget tool to the budget it names: an open one in the window, or a saved one, read only. */
export function routeBudgetTools(callWindow: WindowCaller) {
  return async (name: string, input: unknown, { confirm }: { confirm: boolean }): Promise<ToolReply> => {
    if (name === INSTRUCTIONS_TOOL.name) {
      try {
        return await updateInstructions(asInput(input), confirm, callWindow);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    if (name === 'save_addon') {
      try {
        // Always asked: an add-on is code the app will run.
        return await saveAddonTool(asInput(input), true, callWindow);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    if (name === 'open_addon') {
      const id = asInput(input)['addon'];
      if (!(await readAddon(id)))
        return { ok: false, error: `There's no add-on "${String(id)}". Use list_addons.` };
      return callWindow(OPEN_ADDON_CALL, { addon: id }, { confirm: false, tab: null });
    }
    const tool = BUDGET_TOOLS.find((t) => t.name === name);
    const versionTool = VERSION_TOOLS.some((t) => t.name === name);
    if (!tool && !versionTool) return { ok: false, error: `Unknown tool: ${name}` };
    const { budget: wanted, ...rest } = asInput(input);
    let choice: BudgetChoice;
    try {
      choice = findBudget(await allBudgets(), wanted);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    if (choice.tab) return callWindow(name, rest, { confirm, tab: choice.tab });
    if (!tool) {
      return {
        ok: false,
        error: `"${choice.label}" isn't open in the app. Ask the user to open it to see its versions.`,
      };
    }
    if (tool.edits) {
      return {
        ok: false,
        error: `"${choice.label}" isn't open in the app, so it can only be read. Ask the user to open it to change it.`,
      };
    }
    try {
      return { ok: true, result: tool.run(await readSavedBudget(choice.project!), rest).result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

const MAX_TEXT = 200_000;

export const APP_TOOLS: readonly AppTool[] = [
  {
    name: 'list_addons',
    description:
      "Lists the user's add-ons (pages built on top of Fringe, such as a cash flow, that work on any budget), with what each keeps in a budget, and gives the guide to building them. Read it before save_addon, and when the user asks about an add-on or its figures (then use get_addon_data).",
    inputSchema: { type: 'object', properties: {} },
    async run() {
      return {
        addons: (await listAddons()).map((a) => ({
          addon: a.id,
          name: a.name,
          description: a.description,
          keepsInBudget: a.aboutData || null,
          version: a.version,
        })),
        guide: addonGuide.slice(addonGuide.indexOf('---') + 3).trim(),
      };
    },
  },
  {
    name: 'read_addon',
    description: "An add-on's page (its HTML), to change it with save_addon or to see how it works.",
    inputSchema: {
      type: 'object',
      properties: { addon: { type: 'string', description: 'The add-on’s id, from list_addons.' } },
      required: ['addon'],
    },
    async run(input) {
      const addon = await readAddon(input['addon']);
      if (!addon) throw new Error(`There's no add-on "${String(input['addon'])}". Use list_addons.`);
      return { addon: addon.info.id, ...addon.info, html: addon.html };
    },
  },
  {
    name: 'list_budgets',
    description:
      "Lists the budgets you can work with: the ones open in the app (one is showing) and recently opened ones that aren't open, which you can read but not change. Also gives the user's instructions for all budgets. Every other tool takes an optional budget, named as listed here; without it, it works on the budget showing. Only look at another budget when the user asks about it.",
    inputSchema: { type: 'object', properties: {} },
    async run() {
      const list = await allBudgets();
      return {
        showing: list.find((b) => b.showing)?.label ?? null,
        budgets: list.map((b) => ({
          budget: b.label,
          showing: b.showing,
          open: b.tab !== null,
          canChange: b.tab !== null,
        })),
        instructionsForAllBudgets: await instructionsForAll(),
      };
    },
  },
  {
    name: 'list_budget_files',
    description:
      'Lists the files kept with a budget (the one showing, unless you name another): its knowledge folder of instructions, rules, rate sheets, contracts, deal memos, schedules and anything else the user has given you. Read knowledge/instructions.md before working on a budget.',
    inputSchema: withBudget({ type: 'object', properties: {} }),
    async run(input) {
      const project = await projectFor(input);
      return { folder: project, files: await listBudgetFiles(project) };
    },
  },
  {
    name: 'read_budget_file',
    description:
      'Reads a file from a budget\'s knowledge folder, named as list_budget_files gives it, e.g. "knowledge/instructions.md". Text of any kind (csv, txt, xml, json, html, exports from other programs) comes as it is; Excel (.xlsx) and OpenDocument spreadsheets come as their cells, sheet by sheet; Word and OpenDocument documents as their words. For a PDF or picture it gives the full path: open that with your own file-reading tool. A long file comes in parts: pass the `offset` it gives you for the next one.',
    inputSchema: withBudget({
      type: 'object',
      properties: {
        name: { type: 'string', description: 'e.g. "knowledge/rates.csv"' },
        offset: { type: 'number', description: 'Where to start in a long file, from the last part read.' },
      },
      required: ['name'],
    }),
    async run(input) {
      const project = await projectFor(input);
      const full = budgetFilePath(project, input['name']);
      if (!full) throw new Error(`No file "${String(input['name'])}". Use list_budget_files for the names.`);
      const got = await fileText(full).catch(() => {
        throw new Error(`Couldn't read "${String(input['name'])}".`);
      });
      if (got.kind === 'media')
        return { name: input['name'], path: full, note: 'A PDF or picture: open it at this path.' };
      if (got.kind === 'unreadable') return { name: input['name'], path: full, note: got.why };
      const offset = Math.max(0, Math.floor(Number(input['offset']) || 0));
      const text = got.text.slice(offset, offset + MAX_TEXT);
      const end = offset + text.length;
      return {
        name: input['name'],
        ...(got.how === 'text' ? {} : { readAs: got.how }),
        text,
        ...(end < got.text.length ? { more: true, nextOffset: end, totalLength: got.text.length } : {}),
      };
    },
  },
];

/** Every tool the AI gets: the budget tools (each with `budget`), then the app's own. */
export const AI_TOOLS: readonly {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  edits: boolean;
}[] = [
  ...BUDGET_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: withBudget(t.inputSchema),
    edits: t.edits,
  })),
  ...VERSION_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: withBudget(t.inputSchema),
    edits: t.edits,
  })),
  { ...INSTRUCTIONS_TOOL, inputSchema: withBudget(INSTRUCTIONS_TOOL.inputSchema), edits: true },
  ...ADDON_TOOLS.map((t) => ({ ...t, inputSchema: t.inputSchema as Record<string, unknown>, edits: true })),
  ...APP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    edits: false,
  })),
];

export const runAppTool = (name: unknown, input: unknown): Promise<unknown> | null => {
  const tool = APP_TOOLS.find((t) => t.name === name);
  return tool ? tool.run(asInput(input)) : null;
};
