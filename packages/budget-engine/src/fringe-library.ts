import { EditError } from './edit';
import { type Budget, type FringeDef } from './model';

/**
 * The user's own fringe rates, kept on this computer and shared as a file. Fringe ships with none:
 * there's no public rate sheet, and rates change every year, so each one says when it was right
 * and where it came from. Budgets get copies; changing the library never changes a budget.
 */
export interface LibraryFringe {
  name: string;
  kind: 'percent' | 'flat';
  /** Percent for 'percent'; amount per unit for 'flat'. */
  rate: string;
  /** Flat fringes: the unit the rate is per, e.g. "Hours". */
  unit: string;
  /** Pay a percent fringe stops at, per person; null for none. */
  cutoff: string | null;
  /** When the rate was right, as YYYY-MM-DD; blank when not known. */
  asOf: string;
  /** Where it came from, e.g. "Payroll company rate sheet 2026". */
  note: string;
}

/** The library as a file: what Export writes and Import reads. */
export interface FringeLibraryFile {
  format: 'fringe-rate-library';
  version: 1;
  fringes: LibraryFringe[];
}

export const libraryFile = (fringes: readonly LibraryFringe[]): FringeLibraryFile => ({
  format: 'fringe-rate-library',
  version: 1,
  fringes: [...fringes],
});

const DECIMAL = /^\d+(\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads a library file (or a saved library), refusing anything that isn't one. */
export function parseFringeLibrary(data: unknown): LibraryFringe[] {
  const file = data as Partial<FringeLibraryFile> | null;
  if (typeof file !== 'object' || file === null || file.format !== 'fringe-rate-library') {
    throw new EditError("That isn't a Fringe rate library file.");
  }
  if (file.version !== 1)
    throw new EditError('That rate library was made by a newer Fringe. Update Fringe first.');
  if (!Array.isArray(file.fringes)) throw new EditError('That rate library has no fringes in it.');
  const seen = new Set<string>();
  return file.fringes.map((raw: unknown, i) => {
    const f = raw as Partial<Record<keyof LibraryFringe, unknown>> | null;
    const where = `Fringe ${i + 1} in the file`;
    if (typeof f !== 'object' || f === null) throw new EditError(`${where} isn't a fringe.`);
    const name = typeof f.name === 'string' ? f.name.trim() : '';
    if (!name) throw new EditError(`${where} has no name.`);
    if (seen.has(name.toLowerCase())) throw new EditError(`The file has ${name} twice.`);
    seen.add(name.toLowerCase());
    if (f.kind !== 'percent' && f.kind !== 'flat') throw new EditError(`${name} isn't percent or flat.`);
    if (typeof f.rate !== 'string' || !DECIMAL.test(f.rate)) throw new EditError(`${name} has no rate.`);
    const cutoff = f.cutoff ?? null;
    if (cutoff !== null && (typeof cutoff !== 'string' || !DECIMAL.test(cutoff))) {
      throw new EditError(`${name} has a cutoff that isn't a number.`);
    }
    const asOf = typeof f.asOf === 'string' && DATE.test(f.asOf) ? f.asOf : '';
    return {
      name,
      kind: f.kind,
      rate: f.rate,
      unit: f.kind === 'flat' && typeof f.unit === 'string' ? f.unit : '',
      cutoff: f.kind === 'percent' ? cutoff : null,
      asOf,
      note: typeof f.note === 'string' ? f.note : '',
    };
  });
}

/** Adds fringes to the library; one with a name already there replaces it. */
export function mergeIntoLibrary(
  library: readonly LibraryFringe[],
  incoming: readonly LibraryFringe[],
): { library: LibraryFringe[]; added: number; replaced: number } {
  const next = [...library];
  let added = 0;
  let replaced = 0;
  for (const f of incoming) {
    const i = next.findIndex((g) => g.name.toLowerCase() === f.name.toLowerCase());
    if (i === -1) {
      next.push(f);
      added++;
    } else {
      next[i] = f;
      replaced++;
    }
  }
  return { library: next, added, replaced };
}

/** A budget's fringes as library entries, dated `asOf` and noted as coming from the budget. */
export function libraryFromBudget(budget: Budget, asOf: string): LibraryFringe[] {
  return budget.settings.fringeDefs.map((f) => ({
    name: f.name,
    kind: f.kind,
    rate: f.rate,
    unit: f.kind === 'flat' ? f.unit : '',
    cutoff: f.kind === 'percent' ? f.cutoff : null,
    asOf,
    note: `From ${budget.name}`,
  }));
}

/** The budget fringe a library fringe would replace, matched by name; undefined when it's new. */
export const budgetFringeFor = (budget: Budget, f: LibraryFringe): FringeDef | undefined =>
  budget.settings.fringeDefs.find((d) => d.name.toLowerCase() === f.name.toLowerCase());

/**
 * Copies library fringes into a budget. A fringe the budget already has takes the library's
 * rate, unit and cutoff but keeps the budget's name, so the lines it's on stay on it.
 */
export function addLibraryFringes(budget: Budget, picks: readonly LibraryFringe[]): Budget {
  const defs = [...budget.settings.fringeDefs];
  for (const f of picks) {
    const def: FringeDef = {
      name: f.name,
      kind: f.kind,
      rate: f.rate,
      unit: f.unit,
      cutoff: f.cutoff,
      cutoffInferred: false,
    };
    const i = defs.findIndex((d) => d.name.toLowerCase() === f.name.toLowerCase());
    if (i === -1) defs.push(def);
    else defs[i] = { ...def, name: defs[i]!.name };
  }
  return { ...budget, settings: { ...budget.settings, fringeDefs: defs } };
}
