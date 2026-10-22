import type { RoundingPolicy } from './money';
import { DEFAULT_ROUNDING_POLICY } from './money';

/**
 * A Fringe budget: Topsheet → Category → Account → Detail line.
 * Money and quantities are exact decimal strings (see money.ts).
 */
export interface Budget {
  id: string;
  name: string;
  settings: BudgetSettings;
  categories: Category[];
  /** The file the budget was converted from (e.g. another program's), whose figures are kept to check against. */
  source?: { fileName: string };
  /** Set on a fork: the budget and history point it was copied from (see history.ts). */
  forkedFrom?: { budgetId: string; budgetName: string; entryId: string | null; at: string };
}

/** Totals as the file a budget was converted from shows them, kept for comparison. */
export interface ImportedTotals {
  fringe: string | null;
  original: string;
  total: string;
  variance: string;
}

export interface Category {
  id: string;
  number: string;
  description: string;
  imported: ImportedTotals | null;
  accounts: Account[];
}

export interface Account {
  id: string;
  number: string;
  description: string;
  imported: ImportedTotals | null;
  details: DetailLine[];
  /** Fringe amounts posted to this account (e.g. a category's "Total Fringes" account). */
  postedFringes: PostedFringe[];
  /** Lines whose fringes are worked out together, usually one person's. */
  fringeRanges: FringeRange[];
}

/**
 * Two or more detail lines that share fringe cutoffs, e.g. one person's shoot and wrap weeks:
 * once their combined pay passes a cutoff, that fringe stops for the rest of the range.
 */
export interface FringeRange {
  id: string;
  /** In line order. A line belongs to at most one range. */
  lineIds: string[];
}

export interface PostedFringe {
  kind: 'percent' | 'flat';
  name: string;
  /** Percent for 'percent' fringes; amount per unit for 'flat'. */
  rate: string;
  /** Flat fringes only. */
  unit: string;
  /** Taxable base for 'percent' (after cutoffs); unit count for 'flat'. */
  base: string;
  total: string;
}

export interface DetailLine {
  id: string;
  description: string;
  amount: string;
  unit: string;
  /** A multiplier: people, paid hours per unit (11 for 8 straight and 2 at time and a half)… */
  x: string;
  rate: string;
  /** The currency the line is budgeted in, by code; blank for the budget's own (see currency.ts). */
  currency: string;
  subtotal: string;
  fringes: string[];
  groups: string[];
  globalsUsed: string[];
  location: string;
  set: string;
  /** "In" column: a code, from the budget's list for it. */
  in: string;
  /** Free fields 1 and 2: codes, from the budget's lists for them. */
  ff1: string;
  ff2: string;
  /**
   * Globals or expressions behind the numeric fields, e.g. { amount: 'SW' }.
   * The field itself holds the resolved value.
   */
  formulas: Partial<Record<NumericDetailField, string>>;
  /** True when formulas were worked out on import rather than entered; the imported file doesn't say where globals go. */
  formulasInferred: boolean;
  /** Aggregate fringe percentages as reported on import (e.g. "38.63%"), for comparison. */
  importedFringePercent: { line: string; cumulative: string } | null;
}

export type NumericDetailField = 'amount' | 'x' | 'rate';

/** How money is shown. Independent of how it is calculated (RoundingPolicy). */
export type DisplayPrecision = 'cents' | 'dollars';

/**
 * Where calculated fringe totals are posted:
 * - account: each account's own fringe column
 * - category: one fringe account in each category (e.g. 1199 "Total Fringes")
 * - production-level: a fringe row on the topsheet in each production level (Above-The-Line, …)
 * - budget: one fringe row on the topsheet, after every level
 */
export type FringePosting = 'account' | 'category' | 'production-level' | 'budget';

export interface BudgetSettings {
  /** The title on reports and printouts, e.g. "Night Shift — Shooting Budget"; blank uses the budget's name. */
  title: string;
  /** Notes on what the budget assumes, as safe formatted HTML (see assumptions.ts); printed with reports. */
  assumptions: string;
  rounding: RoundingPolicy;
  displayPrecision: DisplayPrecision;
  coa: CoaSettings;
  fringes: FringePostingSettings;
  /** Account-detail column order and hidden columns for this budget; null uses the app's default. */
  detailColumns: ColumnLayout | null;
  /** Units offered when typing a unit, e.g. "Weeks-45 Hours" = 45 hours. */
  units: UnitDef[];
  /** The budget's own currency, by code, e.g. "USD". Totals and reports are in it. */
  currency: string;
  /** Other currencies lines can be budgeted in, each with its rate in the budget's currency. */
  currencies: CurrencyDef[];
  /** Row colour per group name, as #rrggbb. A line takes the colour of its first coloured group. */
  groupColors: Record<string, string>;
  /** The budget's fringes: rate, and cutoff where there is one. */
  fringeDefs: FringeDef[];
  /** The budget's groups, including ones no line uses yet. */
  groups: string[];
  /** Codes set up for the Set, Location, In, FF1 and FF2 columns, offered while typing. */
  codes: Record<CodeField, string[]>;
  /** Named values used in numeric fields, e.g. SW = 22 shoot weeks. */
  globals: GlobalDef[];
  /** Lines under the topsheet worked out from the budget's total, e.g. Contingency 10%. */
  percentages: BudgetPercentage[];
  /** Tax credits and rebates, worked out from the lines in the groups that qualify. */
  incentives: TaxIncentive[];
  /**
   * Where incentives go: 'net' shows them under the grand total, with a Net Cost line after them;
   * 'grand-total' takes them off the grand total itself.
   */
  incentivePlacement: IncentivePlacement;
  /**
   * The fringes that make a line labor on the crew list (see crew.ts); absent means the budget's
   * workers' comp fringes.
   */
  crewFringes?: string[];
  /** What each add-on keeps for this budget, by add-on id (see addons.ts). */
  addonData?: Record<string, unknown>;
}

export type IncentivePlacement = 'net' | 'grand-total';

/**
 * A tax credit or rebate, e.g. a state's 30% film credit. It's worked out on the lines in the
 * qualifying groups (with their fringes; a line in several counts once), at the program's rate,
 * then at the share actually received, e.g. 80% when the credit is sold at 80 cents on the dollar.
 */
export interface TaxIncentive {
  id: string;
  name: string;
  /** The program's rate: percent of qualifying spend, e.g. "30". */
  rate: string;
  /** Groups whose lines qualify. */
  groups: string[];
  /** Percent of the credit received, e.g. "80"; "100" when it's received in full. */
  realized: string;
  /** Whether the qualifying lines' fringes count too; absent means they do (budgets made before). */
  includeFringes?: boolean;
  /** Fringes that don't count when fringes are included, e.g. ["WC"]; absent means none. */
  excludeFringes?: string[];
  /** The account number it shows under on the topsheet, e.g. "9800"; none when not set. */
  account?: string;
}

/**
 * A topsheet line that is a percentage of the budget, e.g. Contingency 10% or a tax credit at -25%.
 * The base is every category's total (lines and fringes), less the lines in the groups left out.
 * Each is worked out on that base alone, not on the other percentages, and goes into the grand total.
 */
export interface BudgetPercentage {
  id: string;
  name: string;
  /** Percent of the base; negative takes it off the budget (a credit). */
  percent: string;
  /** Groups whose lines, and their fringes, don't count toward the base. */
  excludeGroups: string[];
  /** The account number it shows under on the topsheet, e.g. "9800"; none when not set. */
  account?: string;
}

export interface GlobalDef {
  name: string;
  /** A number or a formula using other globals, e.g. "22" or "SW+2"; blank when not set yet. */
  value: string;
  description: string;
  /** True when the value was worked out on import (the imported file names globals but not their values). */
  inferred: boolean;
}

/** Detail-line columns that take codes from a list set up per budget. */
export type CodeField = 'set' | 'location' | 'in' | 'ff1' | 'ff2';
export const CODE_FIELDS: readonly CodeField[] = ['set', 'location', 'in', 'ff1', 'ff2'];

export interface FringeDef {
  name: string;
  kind: 'percent' | 'flat';
  /** Percent for 'percent'; amount per unit for 'flat'. */
  rate: string;
  /** Flat fringes: the unit the rate is per, e.g. "Hours". */
  unit: string;
  /** Pay a percent fringe stops at, per person (fringe range); null for none. */
  cutoff: string | null;
  /** True when the cutoff was worked out on import rather than entered. */
  cutoffInferred: boolean;
}

export interface CurrencyDef {
  /** e.g. "CAD". */
  code: string;
  /** e.g. "Canadian dollar"; may be blank. */
  name: string;
  /** What one unit of it is worth in the budget's currency, e.g. "0.73"; blank when not set yet. */
  rate: string;
}

export interface UnitDef {
  name: string;
  /** Hours one unit stands for (45 for a 45-hour week). Null when not set. */
  hours: string | null;
  /** True when the hours were worked out on import from the file's hourly fringe counts. */
  hoursInferred?: boolean;
}

/** Column ids are defined by the app; unknown ids are ignored and new columns fall in at their default place. */
export interface ColumnLayout {
  order: string[];
  hidden: string[];
}

/**
 * A topsheet production total such as Above-The-Line. A category belongs to the
 * level with the highest starting number at or below its own number.
 */
export interface ProductionLevel {
  id: string;
  /** Shown as "Total <name>" on the topsheet. */
  name: string;
  /** First category number in this level, e.g. "2000". */
  from: string;
}

/** Chart of accounts structure. */
export interface CoaSettings {
  /** Production totals in topsheet order. */
  levels: ProductionLevel[];
  /**
   * What category numbers look like: # is a digit and anything else appears as typed, e.g. "####"
   * for 1100 or "##-##" for 11-00 (see numbering.ts). null allows any number.
   */
  categoryPattern: string | null;
  /** What account numbers look like, e.g. "####" for 1102 or "##-##" for 11-02. null allows any. */
  accountPattern: string | null;
}

export interface FringePostingSettings {
  posting: FringePosting;
  /** 'category' posting: the account number ending that receives fringes in each category, e.g. "99" → 1199. */
  categoryAccountSuffix: string;
  /** 'budget' posting: the account number on the topsheet's fringe row. */
  budgetAccount: string;
  /** 'production-level' posting: each level's fringe row account number, by level id. */
  levelAccounts: Record<string, string>;
}

export const DEFAULT_BUDGET_SETTINGS: BudgetSettings = {
  title: '',
  assumptions: '',
  rounding: DEFAULT_ROUNDING_POLICY,
  displayPrecision: 'cents',
  coa: {
    levels: [
      { id: 'atl', name: 'Above-The-Line', from: '1000' },
      { id: 'btl', name: 'Below-The-Line', from: '2000' },
      { id: 'post', name: 'Post Production', from: '6000' },
      { id: 'other', name: 'Other', from: '8000' },
    ],
    categoryPattern: null,
    accountPattern: null,
  },
  fringes: { posting: 'account', categoryAccountSuffix: '99', budgetAccount: '', levelAccounts: {} },
  detailColumns: null,
  units: [],
  currency: 'USD',
  currencies: [],
  groupColors: {},
  fringeDefs: [],
  groups: [],
  codes: { set: [], location: [], in: [], ff1: [], ff2: [] },
  globals: [],
  percentages: [],
  incentives: [],
  incentivePlacement: 'net',
};

// The engine is platform-neutral (no DOM or Node types); Web Crypto exists in both Electron and Node 19+.
declare const crypto: { randomUUID(): string };

/** The title reports print: the budget's title, or its name when it has none. */
export function budgetTitle(budget: Budget): string {
  return budget.settings.title.trim() || budget.name;
}

export function newId(): string {
  return crypto.randomUUID();
}
