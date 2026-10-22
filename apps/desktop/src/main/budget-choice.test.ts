import { describe, expect, it } from 'vitest';
import { budgetChoices, findBudget } from './budget-choice';

const open = (tab: string, name: string, project: string | null, showing = false) => ({
  tab,
  name,
  project,
  showing,
});

describe('budget choices', () => {
  it('lists open budgets first, then recent ones that are not open', () => {
    const list = budgetChoices(
      [open('t1', 'Feature', 'C:/B/Feature', true), open('t2', 'Pilot', null)],
      [
        { name: 'Feature', path: 'C:/B/Feature' },
        { name: 'Series', path: 'C:/B/Series' },
      ],
    );
    expect(list.map((b) => [b.label, b.tab, b.showing])).toEqual([
      ['Feature', 't1', true],
      ['Pilot', 't2', false],
      ['Series', null, false],
    ]);
  });

  it('tells budgets with the same name apart by folder, or by number', () => {
    const list = budgetChoices(
      [open('t1', 'Feature', 'C:/B/Feature A'), open('t2', 'feature', null), open('t3', 'Feature', null)],
      [{ name: 'Feature', path: 'C:/B/Feature B' }],
    );
    expect(list.map((b) => b.label)).toEqual([
      'Feature (Feature A)',
      'feature',
      'Feature (2)',
      'Feature (Feature B)',
    ]);
  });
});

describe('find budget', () => {
  const list = budgetChoices(
    [open('t1', 'Feature', 'C:/B/One', true), open('t2', 'Feature', 'C:/B/Two')],
    [{ name: 'Series', path: 'C:/B/Series' }],
  );

  it('means the budget showing when none is named', () => {
    expect(findBudget(list, undefined).tab).toBe('t1');
    expect(findBudget(list, ' ').tab).toBe('t1');
  });

  it('finds a budget by its label or a unique name, ignoring case', () => {
    expect(findBudget(list, 'feature (two)').tab).toBe('t2');
    expect(findBudget(list, 'series').project).toBe('C:/B/Series');
  });

  it('asks for a label when a name is shared, and lists the budgets when none matches', () => {
    expect(() => findBudget(list, 'Feature')).toThrow(/More than one budget is called "Feature"/);
    expect(() => findBudget(list, 'Nope')).toThrow(/"Feature \(One\)", "Feature \(Two\)", "Series"/);
  });

  it('says so when nothing is showing', () => {
    expect(() => findBudget(budgetChoices([], []), undefined)).toThrow(/No budget is showing/);
  });
});
