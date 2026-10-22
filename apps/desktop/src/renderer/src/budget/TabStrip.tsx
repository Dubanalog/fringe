import { useRef, useState } from 'react';
import type { BudgetTab } from './tabs';

interface Props {
  tabs: readonly BudgetTab[];
  activeId: string | null;
  onActivate(id: string | null): void;
  onClose(tab: BudgetTab): void;
  /** The tab whose name is being edited, if any. */
  renaming: string | null;
  onRenaming(id: string | null): void;
  onRename(tab: BudgetTab, name: string): void;
}

/**
 * Open budgets across the top. "+" goes to the start page to open another. Ctrl+Tab switches.
 * Double-click a tab (or F2 on it) to rename the budget.
 */
export function TabStrip({ tabs, activeId, onActivate, onClose, renaming, onRenaming, onRename }: Props) {
  return (
    <div className="tab-strip" role="tablist" aria-label="Open budgets">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="budget-tab"
          role="tab"
          aria-selected={tab.id === activeId}
          tabIndex={tab.id === activeId ? 0 : -1}
          title={tab.budget.source?.fileName ?? tab.budget.name}
          onClick={() => onActivate(tab.id)}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(tab);
          }}
          onDoubleClick={() => onRenaming(tab.id)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') onActivate(tab.id);
            if (e.key === 'F2') onRenaming(tab.id);
          }}
        >
          {renaming === tab.id ? (
            <TabName
              name={tab.budget.name}
              done={(name) => {
                onRenaming(null);
                if (name !== null) onRename(tab, name);
              }}
            />
          ) : (
            <span className="tab-name">{tab.budget.name}</span>
          )}
          {tab.dirty && (
            <span
              className="tab-dirty"
              title={tab.project ? (tab.saveError ? `Not saved: ${tab.saveError}` : 'Saving…') : 'Not saved'}
            >
              ●
            </span>
          )}
          <button
            type="button"
            className="tab-close"
            aria-label={`Close ${tab.budget.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className={activeId === null ? 'tab-new active' : 'tab-new'}
        title="Open another budget"
        aria-label="Open another budget"
        onClick={() => onActivate(null)}
      >
        +
      </button>
    </div>
  );
}

/** A tab's name being edited: Enter or leaving keeps it, Escape puts it back. */
function TabName(props: { name: string; done(name: string | null): void }) {
  const [draft, setDraft] = useState(props.name);
  // Enter or Escape ends it; the blur that follows mustn't end it again.
  const ended = useRef(false);
  const end = (name: string | null) => {
    if (ended.current) return;
    ended.current = true;
    props.done(name);
  };
  const finish = () => {
    const name = draft.trim();
    end(name && name !== props.name ? name : null);
  };
  return (
    <input
      className="tab-name-input"
      aria-label="Budget name"
      value={draft}
      size={Math.max(8, draft.length + 1)}
      maxLength={120}
      autoFocus
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish();
        if (e.key === 'Escape') end(null);
      }}
    />
  );
}
