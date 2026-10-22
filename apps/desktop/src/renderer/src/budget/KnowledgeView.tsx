import { useCallback, useEffect, useState } from 'react';
import type { BudgetFile } from '../../../shared/ipc';

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The files kept with this budget (rate sheets, deal memos, rules, notes), which the AI reads when
 * you ask it about the budget. They live in the budget's project folder.
 */
export function KnowledgeView({ project }: { project: string }) {
  const [files, setFiles] = useState<BudgetFile[] | null>(null);

  const load = useCallback(async () => setFiles(await window.fringe.budgetFiles(project)), [project]);

  useEffect(() => {
    let current = true;
    void window.fringe.budgetFiles(project).then((f) => {
      if (current) setFiles(f);
    });
    // Files added in Explorer show up when the window comes back.
    const refresh = () => void load();
    window.addEventListener('focus', refresh);
    return () => {
      current = false;
      window.removeEventListener('focus', refresh);
    };
  }, [project, load]);

  const add = async () => {
    const added = await window.fringe.addBudgetFiles(project);
    if (added.length > 0) await load();
  };

  return (
    <section className="view view-scroll knowledge-view">
      <h1>Knowledge</h1>
      <p className="muted">
        Files the AI reads when you ask it about this budget: rate sheets, deal memos, union rules, notes. Put
        standing instructions for the AI in a file called <strong>instructions.md</strong>. You can also drop
        files on the AI panel. Instructions for all budgets go in one file kept with all your budgets.
      </p>
      <div className="actions actions-left">
        <button type="button" className="btn btn-primary" onClick={() => void add()}>
          Add Files…
        </button>
        <button type="button" className="btn" onClick={() => void window.fringe.revealProject(project)}>
          Show Folder
        </button>
        <button type="button" className="btn" onClick={() => void window.fringe.openAllInstructions()}>
          Instructions for All Budgets
        </button>
      </div>
      {files === null ? null : files.length === 0 ? (
        <p className="muted">No files yet.</p>
      ) : (
        <table className="knowledge-files">
          <thead>
            <tr>
              <th>File</th>
              <th className="num">Size</th>
              <th>Changed</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.name}>
                <td>
                  <button
                    type="button"
                    className="link-btn"
                    title="Open"
                    onClick={() => void window.fringe.openBudgetFile(project, f.name)}
                  >
                    {f.name.replace(/^knowledge\//, '')}
                  </button>
                </td>
                <td className="num">{size(f.size)}</td>
                <td>{new Date(f.modified).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
