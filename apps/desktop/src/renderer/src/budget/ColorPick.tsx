import { useRef, useState } from 'react';

const PALETTE = [
  '#e5484d',
  '#f76b15',
  '#f5b400',
  '#30a46c',
  '#12a594',
  '#0090ff',
  '#3e63dd',
  '#8e4ec6',
  '#d6409f',
  '#8d8d86',
];

/**
 * A colour chosen from a few clear swatches, or any colour; or none. The system colour input
 * stays mounted outside the popover: its dialog takes focus, which closes the popover.
 */
export function ColorPick(props: {
  label: string;
  value: string | null;
  onChange(color: string | null): void;
  /** The small swatch used in lists. */
  small?: boolean;
}) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const other = useRef<HTMLInputElement>(null);
  const { value } = props;
  const size = props.small ? 'swatch' : 'swatch swatch-lg';
  const close = () => setAt(null);
  return (
    <div
      className="color-pick"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && at) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        type="button"
        className={value ? size : `${size} swatch-empty`}
        style={value ? { background: value } : undefined}
        aria-label={`${props.label}: ${value ?? 'none'}`}
        aria-expanded={at !== null}
        title={value ? `${props.label}. Click to change.` : `${props.label}: none. Click to choose one.`}
        onClick={(e) => {
          if (at) return close();
          const r = e.currentTarget.getBoundingClientRect();
          // Fixed, so a scrolling list or pane doesn't clip it; kept on screen.
          setAt({
            left: Math.max(8, Math.min(r.left, window.innerWidth - 190)),
            top: r.bottom + 190 > window.innerHeight ? Math.max(8, r.top - 190) : r.bottom + 6,
          });
        }}
      />
      <input
        ref={other}
        type="color"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        value={value ?? '#3e63dd'}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {at && (
        <div className="color-popover" role="dialog" aria-label={props.label} style={at}>
          <div className="color-grid">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={c === value ? 'swatch swatch-lg selected' : 'swatch swatch-lg'}
                style={{ background: c }}
                aria-label={c}
                onClick={() => {
                  props.onChange(c);
                  close();
                }}
              />
            ))}
          </div>
          <div className="color-more">
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                close();
                const input = other.current;
                if (!input) return;
                try {
                  input.showPicker();
                } catch {
                  input.click();
                }
              }}
            >
              Other colour…
            </button>
            {value && (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  props.onChange(null);
                  close();
                }}
              >
                No colour
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
