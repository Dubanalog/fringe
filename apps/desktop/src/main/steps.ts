/** What a user sees for one of Claude's steps, e.g. "Looked at account 2100". */
export function describeTool(name: string, input: Record<string, unknown>): string {
  const step = describeStep(name, input);
  const budget = input['budget'];
  return typeof budget === 'string' && budget.trim() !== '' ? `${step} (${budget.trim()})` : step;
}

function describeStep(name: string, input: Record<string, unknown>): string {
  const tool = name.replace(/^mcp__fringe__/, '');
  const file = (p: unknown) => (typeof p === 'string' ? (p.split(/[\\/]/).pop() ?? p) : 'a file');
  switch (tool) {
    case 'list_budgets':
      return 'Looked at the list of budgets';
    case 'get_budget_summary':
      return 'Looked over the budget';
    case 'get_account':
      return `Looked at account ${String(input['account'] ?? '')}`.trim();
    case 'get_import_report':
      return 'Checked the import report';
    case 'get_fringe_bases':
      return 'Checked the fringe bases';
    case 'record_file_figures':
      return "Noted the file's totals to check against";
    case 'set_global':
      return `Changed global ${String(input['name'] ?? '')}`.trim();
    case 'set_fringe_cutoff':
      return 'Changed a fringe cutoff';
    case 'set_unit_hours':
      return 'Changed unit hours';
    case 'set_fringe_range':
    case 'remove_fringe_ranges':
      return 'Changed fringe ranges';
    case 'set_fringe_posting':
      return 'Changed where a fringe posts';
    case 'add_category':
      return `Added category ${String(input['description'] ?? '')}`.trim();
    case 'add_account':
      return `Added account ${String(input['description'] ?? '')}`.trim();
    case 'add_lines':
      return `Added lines to ${String(input['account'] ?? '')}`.trim();
    case 'update_lines':
      return `Changed lines in ${String(input['account'] ?? '')}`.trim();
    case 'delete_lines':
      return `Deleted lines in ${String(input['account'] ?? '')}`.trim();
    case 'move_lines':
      return `Moved lines in ${String(input['account'] ?? '')}`.trim();
    case 'delete_accounts':
      return 'Deleted accounts';
    case 'delete_categories':
      return 'Deleted categories';
    case 'move_account':
      return `Moved account ${String(input['account'] ?? '')}`.trim();
    case 'renumber_and_rename':
      return 'Renumbered or renamed';
    case 'set_number_patterns':
      return 'Changed the number format';
    case 'set_fringe':
      return `Set up fringe ${String(input['name'] ?? '')}`.trim();
    case 'delete_fringe':
      return `Deleted fringe ${String(input['name'] ?? '')}`.trim();
    case 'delete_unit':
      return `Deleted unit ${String(input['name'] ?? '')}`.trim();
    case 'rename_global':
      return `Renamed global ${String(input['name'] ?? '')}`.trim();
    case 'delete_global':
      return `Deleted global ${String(input['name'] ?? '')}`.trim();
    case 'set_group':
      return `Set up group ${String(input['name'] ?? '')}`.trim();
    case 'delete_group':
      return `Deleted group ${String(input['name'] ?? '')}`.trim();
    case 'set_code':
      return `Set up code ${String(input['code'] ?? '')}`.trim();
    case 'delete_code':
      return `Deleted code ${String(input['code'] ?? '')}`.trim();
    case 'set_percentage':
      return `Set ${String(input['name'] ?? 'a percentage')}`;
    case 'delete_percentage':
      return `Took off ${String(input['name'] ?? 'a percentage')}`;
    case 'set_budget_options':
      return 'Changed budget options';
    case 'list_budget_files':
      return "Looked at the budget's files";
    case 'list_addons':
      return 'Looked at the add-ons';
    case 'read_addon':
      return `Read the add-on ${String(input['addon'] ?? '')}`.trim();
    case 'save_addon':
      return `${input['addon'] ? 'Changed' : 'Built'} the add-on ${String(input['name'] ?? '')}`.trim();
    case 'open_addon':
      return 'Opened the add-on';
    case 'get_addon_data':
      return `Read the ${String(input['addon'] ?? 'add-on')} figures`;
    case 'set_addon_data':
      return `Filled in ${String(input['addon'] ?? 'the add-on')}`;
    case 'read_budget_file':
      return `Read ${file(input['name'])}`;
    case 'Read':
      return isOverflowFile(input['file_path'])
        ? 'Read the rest of the search results'
        : `Read ${file(input['file_path'])}`;
    case 'Glob':
    case 'Grep':
      return 'Searched the files';
    default:
      return tool.replace(/_/g, ' ');
  }
}

/**
 * When a tool's output is too long, Claude Code saves it to its own file (named after the call,
 * e.g. toolu_015G….txt, in a tool-results folder) and Claude reads it back. That isn't one of the
 * user's files, so its name shouldn't show.
 */
function isOverflowFile(p: unknown): boolean {
  if (typeof p !== 'string') return false;
  const parts = p.split(/[\\/]/);
  return parts.includes('tool-results') || /^toolu_\w+\.\w+$/.test(parts.at(-1) ?? '');
}
