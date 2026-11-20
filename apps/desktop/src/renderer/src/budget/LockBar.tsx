import { useState } from 'react';
import { activeBranch, branchName, canBranchFrom, isEditable, versionsOn } from '@fringe/budget-engine';
import { BranchNamer, fullTime, shortDate } from './BranchTreeView';
import { versionLabel } from './report-options';
import type { BudgetTab, TabsAction } from './tabs';

/** True when the lock bar has something to say: the tab shows a point that can't be edited. */
export function needsLockBar(tab: BudgetTab): boolean {
  return !isEditable(tab.history) || !!tab.heldEdit;
}

/**
 * Above a budget that shows a version or an earlier point, which stays as it was. Says what's
 * showing, and offers to start a branch from it or go back to the branch's latest. A change made
 * here is held until the user names a new branch for it (or drops it).
 */
export function LockBar({ tab, dispatch }: { tab: BudgetTab; dispatch(action: TabsAction): void }) {
  const [naming, setNaming] = useState(false);
  const { history } = tab;
  const branch = activeBranch(history);
  const name = branchName(branch, tab.budget.name);
  const entry = history.entries[history.current];
  const version = entry ? versionsOn(history).find((v) => v.entryId === entry.id) : undefined;
  const here = version ? `${name} ${versionLabel(version)}` : `${name}, an earlier point`;
  const canBranch = !!entry && canBranchFrom(history, entry.id);
  const held = tab.heldEdit;

  const what = version
    ? [
        version.sentOn ? `was sent ${shortDate(version.sentOn)}` : `was saved ${fullTime(version.savedAt)}`,
        version.sentTo ? `to ${version.sentTo}` : '',
      ]
        .filter(Boolean)
        .join(' ')
    : entry
      ? `is from ${fullTime(entry.at)}`
      : '';

  if (held || naming) {
    if (!canBranch || !entry) {
      return (
        <div className="lock-bar" role="status">
          <span className="lock-text">
            <strong>{here}</strong> can’t be changed, and a branch can only start from a saved version.
          </span>
          <button type="button" className="btn" onClick={() => dispatch({ type: 'dropEdit', id: tab.id })}>
            Drop the change
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => dispatch({ type: 'openBranch', id: tab.id, branchId: branch.id })}
          >
            Back to latest
          </button>
        </div>
      );
    }
    return (
      <div className="lock-bar lock-naming">
        {held && (
          <p className="lock-text">
            <strong>{here}</strong> stays as it was. To keep your change, put it on a new branch.
          </p>
        )}
        <BranchNamer
          history={history}
          from={here}
          cancelLabel={held ? 'Drop the change' : 'Cancel'}
          close={() => {
            setNaming(false);
            if (held) dispatch({ type: 'dropEdit', id: tab.id });
          }}
          create={(branchName) => {
            setNaming(false);
            dispatch(
              held
                ? { type: 'branchWithEdit', id: tab.id, name: branchName }
                : { type: 'createBranch', id: tab.id, name: branchName, fromEntryId: entry.id },
            );
          }}
        />
      </div>
    );
  }

  return (
    <div className="lock-bar" role="status">
      <span className="lock-icon" aria-hidden="true" />
      <span className="lock-text">
        <strong>{here}</strong> {what && `${what} and `}stays as it was.{' '}
        {canBranch ? 'To change it, start a branch from here.' : 'It can’t be changed.'}
      </span>
      {canBranch && (
        <button type="button" className="btn btn-primary" onClick={() => setNaming(true)}>
          Start a branch from here…
        </button>
      )}
      <button
        type="button"
        className="btn"
        onClick={() => dispatch({ type: 'openBranch', id: tab.id, branchId: branch.id })}
      >
        Back to latest
      </button>
    </div>
  );
}
