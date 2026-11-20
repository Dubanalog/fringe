import { describe, expect, it } from 'vitest';
import { budgetChoices, chatNote, findBudget } from './budget-choice';

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

describe("the chat's budget", () => {
  const tabs = [open('t1', 'Feature', 'C:/B/Feature'), open('t2', 'Pilot', 'C:/B/Pilot', true)];
  const choices = budgetChoices(tabs, []);
  const chat = { tab: 't1', name: 'Feature' };

  it("stays on the chat's budget while the user looks at another tab", () => {
    expect(findBudget(choices, undefined, chat).tab).toBe('t1');
    expect(findBudget(choices, '', chat).tab).toBe('t1');
  });

  it('goes to the budget showing when there is no chat budget', () => {
    expect(findBudget(choices, undefined).tab).toBe('t2');
  });

  it("lets a named budget win over the chat's", () => {
    expect(findBudget(choices, 'Pilot', chat).tab).toBe('t2');
  });

  it("stops when the chat's budget was closed", () => {
    expect(() => findBudget(budgetChoices([tabs[1]!], []), undefined, chat)).toThrow(/"Feature".*was closed/);
  });

  it("names the chat's budget, the one showing and the rest in the note", () => {
    const three = [...tabs, open('t3', 'Series', null)];
    expect(chatNote(three, chat)).toBe(
      '(From Fringe, not typed by the user: this chat works on "Feature"; tools you call without naming a budget go to it. The user is looking at "Pilot". Also open: "Series".)',
    );
    expect(chatNote(three, { tab: 't2', name: 'Pilot' })).toBe(
      '(From Fringe, not typed by the user: this chat works on "Pilot"; tools you call without naming a budget go to it. Also open: "Feature", "Series".)',
    );
    expect(chatNote(three, null)).toBe(
      '(From Fringe, not typed by the user: the budget showing is "Pilot". Also open: "Feature", "Series".)',
    );
  });
});
