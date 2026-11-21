import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BudgetHistory,
  historyEvents,
  mainBudget,
  newProjectFile,
  projectFolderName,
  storeEvent,
} from '../../packages/budget-engine/src/index';
import { SAMPLE_KNOWLEDGE, sampleHistory } from '../../apps/desktop/src/main/sample-budget';

/**
 * "Fringe Life", the sample budget in the manual's screenshots, is built in
 * apps/desktop/src/main/sample-budget.ts (the start screen opens a copy of it too).
 */
export const buildHistory = sampleHistory;

/**
 * Writes the history as a project folder in `root`, as the app would save it, plus a Global
 * Knowledge folder for the Settings screenshot. Returns its path.
 */
export function writeProject(root: string, history: BudgetHistory): string {
  const budget = mainBudget(history);
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
  for (const [name, text] of Object.entries(SAMPLE_KNOWLEDGE)) {
    writeFileSync(join(path, 'knowledge', name), text);
  }
  const global = join(root, 'Global Knowledge');
  mkdirSync(global, { recursive: true });
  writeFileSync(
    join(global, 'Chart of accounts.csv'),
    'Acct,Description\n1100,STORY & RIGHTS\n1200,PRODUCERS\n',
  );
  writeFileSync(join(global, 'House rules.md'), 'Contingency is 10% of the budget before tax credits.\n');
  return path;
}
