import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUDGET_TOOLS,
  type Budget,
  type BudgetHistory,
  MAIN_BRANCH,
  createBranch,
  historyEvents,
  newBudget,
  newProjectFile,
  openBranch,
  projectFolderName,
  recordChange,
  saveVersion,
  startHistory,
  storeEvent,
} from '../../packages/budget-engine/src/index';

/**
 * "Fringe Life", the sample budget in the manual's screenshots: a small independent feature with a
 * few weeks of history and three saved versions. Every rate in it is a made-up round number for
 * the pictures, not a real union or payroll rate.
 */

const TOOLS = new Map(BUDGET_TOOLS.map((t) => [t.name, t]));

type Line = Record<string, unknown>;
const line = (
  description: string,
  amount: string | number,
  unit: string,
  rate: string | number,
  more: Line = {},
): Line => ({ description, amount, unit, rate, ...more });

/** Fringes for people on payroll, and for union crew. */
const CREW = ['Payroll Taxes', "Workers' Comp"];
const UNION = [...CREW, 'Union Pension & Health'];
const STATE = { groups: ['In-State'] };

/** Builds the budget's history. Dates run from early October to mid November 2026. */
export function buildHistory(): BudgetHistory {
  let day = new Date('2026-10-01T15:00:00Z');
  const at = (hours = 2) => {
    day = new Date(day.getTime() + hours * 3_600_000);
    return day.toISOString();
  };
  let history = startHistory(newBudget('Fringe Life'), 'Created', at(0));
  let budget: Budget = history.entries[0]!.budget;

  const run = (name: string, input: Record<string, unknown>, label?: string, hours = 2) => {
    const tool = TOOLS.get(name);
    if (!tool) throw new Error(`No tool ${name}`);
    const out = tool.run(budget, input);
    if (!out.budget) throw new Error(`${name} changed nothing`);
    budget = out.budget;
    // Most changes read as the user's; a few stay marked as the AI's.
    const text = label ?? (out.label ?? name).replace(/^AI: /, '');
    history = recordChange(history, budget, text.charAt(0).toUpperCase() + text.slice(1), at(hours));
  };
  const version = (
    number: string,
    name: string,
    sentOn: string,
    sentTo: string,
    notes: string,
    changes: string,
  ) => {
    history = saveVersion(
      history,
      { number, name, sentOn, sentTo, notes, changes, pdf: null },
      at(1),
    ).history;
  };

  // Setup.
  run('set_budget_options', {
    title: 'FRINGE LIFE: Production Budget',
    productionTotals: [
      { name: 'Above-The-Line', from: '1000' },
      { name: 'Below-The-Line', from: '2000' },
      { name: 'Post Production', from: '5000' },
      { name: 'Other', from: '6000' },
    ],
  });
  run('set_fringe', { name: 'Payroll Taxes', kind: 'percent', rate: '10', cutoff: '150000' });
  run('set_fringe', { name: 'Union Pension & Health', kind: 'percent', rate: '15' });
  run('set_fringe', { name: "Workers' Comp", kind: 'percent', rate: '3' });
  run('set_unit_hours', { unit: 'Days', hours: '10', confirmed: true }, 'Days are 10 hours');
  run('set_unit_hours', { unit: 'Weeks', hours: '50', confirmed: true }, 'Weeks are 50 hours');
  run('set_global', { name: 'SHOOT', value: '25', description: 'Shoot days' });
  run('set_global', { name: 'SWEEKS', value: 'SHOOT/5', description: 'Shoot weeks' });
  run('set_global', { name: 'PREP', value: '4', description: 'Prep weeks' });
  run('set_global', { name: 'WRAP', value: '1', description: 'Wrap weeks' });
  run('set_group', { name: 'In-State', color: '#fff1c7' });
  run('set_code', { column: 'location', code: 'DINER', description: "Rosie's Diner" });
  run('set_code', { column: 'location', code: 'MOTEL', description: 'Starlite Motel' });
  run('set_code', { column: 'set', code: 'INT DINER', description: 'Diner, inside' });
  run('set_code', { column: 'set', code: 'EXT HWY', description: 'Highway, night' });

  // Above the line.
  run('add_category', {
    number: '1100',
    description: 'STORY & RIGHTS',
    accounts: [
      {
        number: '1101',
        description: 'RIGHTS',
        lines: [line('Option and purchase of novel', 1, 'Flat', 75000)],
      },
      {
        number: '1102',
        description: 'WRITERS',
        lines: [
          line('Screenplay', 1, 'Flat', 150000, { fringes: CREW }),
          line('Polish', 1, 'Flat', 25000, { fringes: CREW }),
        ],
      },
    ],
  });
  run('add_category', {
    number: '1200',
    description: 'PRODUCERS',
    accounts: [
      { number: '1201', description: 'PRODUCERS', lines: [line('Producer', 1, 'Flat', 150000)] },
      {
        number: '1202',
        description: 'LINE PRODUCER',
        lines: [line('Line Producer', 'PREP+SWEEKS+WRAP', 'Weeks', 5000, { fringes: CREW })],
      },
    ],
  });
  run('add_category', {
    number: '1300',
    description: 'DIRECTOR',
    accounts: [
      {
        number: '1301',
        description: 'DIRECTOR',
        lines: [line('Director', 1, 'Flat', 250000, { fringes: UNION })],
      },
    ],
  });
  run('add_category', {
    number: '1400',
    description: 'CAST',
    accounts: [
      {
        number: '1401',
        description: 'PRINCIPAL CAST',
        lines: [
          line('Lead: Rosie', 1, 'Flat', 300000, { fringes: UNION }),
          line('Lead: Hank', 1, 'Flat', 200000, { fringes: UNION }),
          line('Supporting cast', 'SWEEKS', 'Weeks', 4000, { x: 4, fringes: UNION }),
        ],
      },
      {
        number: '1402',
        description: 'DAY PLAYERS',
        lines: [line('Day players', 12, 'Days', 1200, { x: 2, fringes: UNION })],
      },
    ],
  });

  // Below the line.
  run('add_category', {
    number: '2000',
    description: 'PRODUCTION STAFF',
    accounts: [
      {
        number: '2001',
        description: 'UNIT PRODUCTION MANAGER',
        lines: [
          line('UPM: prep', 'PREP', 'Weeks', 4500, { fringes: UNION, ...STATE }),
          line('UPM: shoot', 'SWEEKS', 'Weeks', 4500, { fringes: UNION, ...STATE }),
          line('UPM: wrap', 'WRAP', 'Weeks', 4500, { fringes: UNION, ...STATE }),
        ],
      },
      {
        number: '2002',
        description: 'ASSISTANT DIRECTORS',
        lines: [
          line('1st AD', 'PREP-1+SWEEKS', 'Weeks', 4200, { fringes: UNION, ...STATE }),
          line('2nd AD', 'SWEEKS+1', 'Weeks', 3000, { fringes: UNION, ...STATE }),
        ],
      },
      {
        number: '2003',
        description: 'PRODUCTION ACCOUNTANT',
        lines: [
          line('Production Accountant', 'PREP+SWEEKS+WRAP+2', 'Weeks', 2800, { fringes: CREW, ...STATE }),
        ],
      },
    ],
  });
  run('add_category', {
    number: '2200',
    description: 'ART DEPARTMENT',
    accounts: [
      {
        number: '2201',
        description: 'PRODUCTION DESIGNER',
        lines: [line('Production Designer', 'PREP+SWEEKS', 'Weeks', 3800, { fringes: UNION, ...STATE })],
      },
      {
        number: '2202',
        description: 'SET DRESSING',
        lines: [
          line('Set dresser', 'SWEEKS+2', 'Weeks', 1800, { x: 2, fringes: CREW, ...STATE }),
          line('Diner dressing', 1, 'Allow', 18000, { set: 'INT DINER', location: 'DINER', ...STATE }),
        ],
      },
    ],
  });
  run('add_category', {
    number: '2700',
    description: 'WARDROBE',
    accounts: [
      {
        number: '2701',
        description: 'COSTUME DESIGNER',
        lines: [line('Costume Designer', 'PREP+SWEEKS', 'Weeks', 3000, { fringes: UNION, ...STATE })],
      },
      {
        number: '2702',
        description: 'WARDROBE PURCHASES',
        lines: [line('Purchases and rentals', 1, 'Allow', 35000, STATE)],
      },
    ],
  });
  run('add_category', {
    number: '3000',
    description: 'CAMERA',
    accounts: [
      {
        number: '3001',
        description: 'CAMERA CREW',
        lines: [
          line('Director of Photography', 'SHOOT', 'Days', 1500, { fringes: UNION, ...STATE }),
          line('DP prep', 5, 'Days', 1500, { fringes: UNION, ...STATE }),
          line('1st AC', 'SHOOT', 'Days', 650, { fringes: UNION, ...STATE }),
          line('2nd AC', 'SHOOT', 'Days', 520, { fringes: UNION, ...STATE }),
          line('DP box rental', 'SWEEKS', 'Weeks', 500, STATE),
        ],
      },
      {
        number: '3002',
        description: 'CAMERA RENTALS',
        lines: [
          line('Camera package', 'SWEEKS', 'Weeks', 9500, STATE),
          line('Night exteriors: extra lenses', 3, 'Days', 1200, { set: 'EXT HWY', ...STATE }),
        ],
      },
    ],
  });
  run('set_fringe_range', { account: '3001', lines: [1, 2] }, 'Fringe range on 3001 lines 1–2');
  run('add_category', {
    number: '3100',
    description: 'GRIP & ELECTRIC',
    accounts: [
      {
        number: '3101',
        description: 'GRIP & ELECTRIC CREW',
        lines: [
          line('Gaffer', 'SHOOT+3', 'Days', 600, { fringes: UNION, ...STATE }),
          line('Key Grip', 'SHOOT+3', 'Days', 600, { fringes: UNION, ...STATE }),
          line('Electricians and grips', 'SHOOT', 'Days', 480, { x: 4, fringes: UNION, ...STATE }),
        ],
      },
      {
        number: '3102',
        description: 'LIGHTING & GRIP RENTALS',
        lines: [line('Lighting and grip package', 'SWEEKS', 'Weeks', 12000, STATE)],
      },
    ],
  });
  run('add_category', {
    number: '3300',
    description: 'PRODUCTION SOUND',
    accounts: [
      {
        number: '3301',
        description: 'SOUND CREW',
        lines: [
          line('Sound Mixer', 'SHOOT', 'Days', 650, { fringes: UNION, ...STATE }),
          line('Boom Operator', 'SHOOT', 'Days', 500, { fringes: UNION, ...STATE }),
          line('Sound kit rental', 'SWEEKS', 'Weeks', 1500, STATE),
        ],
      },
    ],
  });
  run('add_category', {
    number: '3500',
    description: 'LOCATIONS',
    accounts: [
      {
        number: '3501',
        description: 'LOCATION FEES',
        lines: [
          line("Rosie's Diner", 8, 'Days', 4000, { location: 'DINER', ...STATE }),
          line('Starlite Motel', 6, 'Days', 2500, { location: 'MOTEL', ...STATE }),
        ],
      },
      {
        number: '3502',
        description: 'LOCATION MANAGER',
        lines: [line('Location Manager', 'PREP+SWEEKS+WRAP', 'Weeks', 2800, { fringes: UNION, ...STATE })],
      },
    ],
  });
  run('add_category', {
    number: '3600',
    description: 'TRANSPORTATION',
    accounts: [
      {
        number: '3601',
        description: 'DRIVERS',
        lines: [line('Drivers', 'SHOOT+4', 'Days', 420, { x: 5, fringes: UNION, ...STATE })],
      },
      {
        number: '3602',
        description: 'VEHICLES',
        lines: [line('Trucks, vans and trailers', 'SWEEKS', 'Weeks', 15000, STATE)],
      },
    ],
  });
  run('add_category', {
    number: '3700',
    description: 'CATERING',
    accounts: [
      {
        number: '3701',
        description: 'MEALS',
        lines: [line('Crew meals', 'SHOOT', 'Days', 30, { x: 80, ...STATE })],
      },
    ],
  });

  // Post production.
  run('add_category', {
    number: '5100',
    description: 'EDITORIAL',
    accounts: [
      {
        number: '5101',
        description: 'EDITORS',
        lines: [
          line('Editor', 20, 'Weeks', 4000, { fringes: UNION }),
          line('Assistant Editor', 20, 'Weeks', 2200, { fringes: UNION }),
        ],
      },
    ],
  });
  run('add_category', {
    number: '5200',
    description: 'MUSIC',
    accounts: [
      {
        number: '5201',
        description: 'COMPOSER & LICENSING',
        lines: [line('Composer package', 1, 'Flat', 60000), line('Song licenses', 4, 'Allow', 10000)],
      },
    ],
  });
  run('add_category', {
    number: '5300',
    description: 'POST SOUND',
    accounts: [
      {
        number: '5301',
        description: 'SOUND EDITING & MIX',
        lines: [line('Sound editing and mix', 1, 'Allow', 90000)],
      },
    ],
  });

  // Other.
  run('add_category', {
    number: '6100',
    description: 'INSURANCE',
    accounts: [
      {
        number: '6101',
        description: 'PRODUCTION PACKAGE',
        lines: [line('Production insurance', 1, 'Allow', 55000)],
      },
    ],
  });
  run('add_category', {
    number: '6200',
    description: 'LEGAL & ACCOUNTING',
    accounts: [
      {
        number: '6201',
        description: 'LEGAL',
        lines: [line('Production counsel', 1, 'Allow', 60000), line('Clearances', 1, 'Allow', 12000)],
      },
    ],
  });
  run('set_percentage', { name: 'Contingency', percent: 10, account: '9800' });
  run('set_tax_incentive', {
    name: 'State Tax Credit',
    rate: 25,
    groups: ['In-State'],
    realized: 90,
    includeFringes: true,
    account: '9900',
  });
  run(
    'set_assumptions',
    {
      html:
        '<h2>Schedule</h2><ul><li>4 weeks prep, 25 shoot days (5-day weeks), 1 week wrap.</li><li>10-hour days, 50-hour weeks.</li></ul>' +
        '<h2>Locations</h2><ul><li>Shot entirely in-state; all below-the-line spend qualifies for the state credit.</li><li>Credit sold at 90¢ on the dollar.</li></ul>' +
        '<h2>Fringes</h2><ul><li>Rates in this budget are placeholders until the payroll company confirms them.</li></ul>',
    },
    'AI: drafted the assumptions',
  );

  version(
    '1.0',
    'First pass',
    '2026-10-09',
    'Producers',
    'Built from the October 2 script. Placeholder fringe rates.',
    'First version.',
  );

  // Producers' notes.
  day = new Date('2026-10-14T16:00:00Z');
  run('update_lines', { account: '1401', lines: [{ line: 1, rate: 350000 }] }, 'Rate on 1401 line 1');
  run('add_category', {
    number: '5400',
    description: 'VISUAL EFFECTS',
    accounts: [
      { number: '5401', description: 'VFX VENDOR', lines: [line('Highway crash shots', 1, 'Allow', 120000)] },
    ],
  });
  run(
    'add_lines',
    { account: '3002', lines: [line('Drone and operator', 2, 'Days', 3500, STATE)] },
    'Added a line to 3002',
  );
  version(
    '1.1',
    'Producer notes',
    '2026-10-16',
    'Producers',
    'Rosie deal closed higher; VFX added for the crash.',
    'Rosie up 50,000 (1401). New 5400 Visual Effects for the highway crash. Drone day added to camera.',
  );
  const v11 = history.entries[history.current]!.id;

  // The studio's cut.
  day = new Date('2026-10-27T15:00:00Z');
  run('set_global', { name: 'SHOOT', value: '22' }, 'SHOOT = 22', 3);
  run('update_lines', { account: '5401', lines: [{ line: 1, rate: 80000 }] }, 'Rate on 5401 line 1');
  run('delete_lines', { account: '3002', lines: [3] }, 'Deleted a line in 3002');
  run('update_lines', { account: '3501', lines: [{ line: 1, amount: 6 }] }, 'Amount on 3501 line 1');
  version(
    '2.0',
    'Studio draft',
    '2026-10-30',
    'Studio, completion bond',
    'Answers the studio note to bring the budget down.',
    'Shoot cut from 25 to 22 days. VFX down 40,000. Drone cut. Two fewer diner days.',
  );

  // A branch that keeps the 25-day schedule, for the producers to compare.
  day = new Date('2026-11-04T16:00:00Z');
  history = createBranch(history, '25-day shoot', v11, at(0)).history;
  budget = history.entries[history.current]!.budget;
  run('update_lines', { account: '5401', lines: [{ line: 1, rate: 80000 }] }, 'Rate on 5401 line 1');
  version(
    '1.0',
    'Full schedule',
    '2026-11-06',
    'Producers',
    'Keeps all 25 shoot days; VFX at the studio number.',
    'From v1.1 with VFX down 40,000.',
  );
  history = openBranch(history, MAIN_BRANCH);
  budget = history.entries[history.current]!.budget;

  // Since the studio draft.
  day = new Date('2026-11-12T17:00:00Z');
  run('set_percentage', { name: 'Completion Bond', percent: 2, account: '9810' });
  run('update_lines', { account: '3701', lines: [{ line: 1, rate: 35 }] }, 'AI: catering 35 a head');
  return history;
}

/** Writes the history as a project folder in `root`, as the app would save it. Returns its path. */
export function writeProject(root: string, history: BudgetHistory): string {
  const budget = history.entries[history.current]!.budget;
  const path = join(root, projectFolderName(budget.name));
  mkdirSync(join(path, 'history', 'objects'), { recursive: true });
  mkdirSync(join(path, 'knowledge'), { recursive: true });
  mkdirSync(join(path, 'versions'), { recursive: true });
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const lines: string[] = [];
  for (const event of historyEvents(history, history.entries.at(-1)!.at)) {
    const { line: stored, pieces } = storeEvent(event, hash);
    for (const [key, text] of pieces) writeFileSync(join(path, 'history', 'objects', `${key}.json`), text);
    lines.push(JSON.stringify(stored) + '\n');
  }
  writeFileSync(join(path, 'history', 'events.jsonl'), lines.join(''));
  writeFileSync(join(path, 'budget.json'), JSON.stringify(budget, null, 1) + '\n');
  writeFileSync(
    join(path, 'project.json'),
    JSON.stringify(newProjectFile(budget.name, history.entries[0]!.at), null, 2) + '\n',
  );
  const knowledge = join(path, 'knowledge');
  writeFileSync(
    join(knowledge, 'instructions.md'),
    'Keep the diner days in 3501 in step with the shooting schedule.\nRound new rates to the dollar.\n',
  );
  writeFileSync(
    join(knowledge, 'Camera package quote.csv'),
    'Item,Weekly\nCamera body,4200\nLens set,3100\nSupport and monitors,2200\n',
  );
  writeFileSync(
    join(knowledge, 'Diner location notes.md'),
    'Six shoot days. Owner closes the diner for us.\n',
  );
  const global = join(root, 'Global Knowledge');
  mkdirSync(global, { recursive: true });
  writeFileSync(
    join(global, 'Chart of accounts.csv'),
    'Acct,Description\n1100,STORY & RIGHTS\n1200,PRODUCERS\n',
  );
  writeFileSync(join(global, 'House rules.md'), 'Contingency is 10% of the budget before tax credits.\n');
  return path;
}
