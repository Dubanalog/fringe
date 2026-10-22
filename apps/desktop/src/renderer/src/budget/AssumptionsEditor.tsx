import { cleanAssumptions } from '@fringe/budget-engine';
import { useEffect, useRef } from 'react';
import { ColorPick } from './ColorPick';
import { keys } from '../keys';

const BLOCKS = [
  { value: 'p', label: 'Paragraph' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
] as const;

const SIZES = [
  { value: '2', label: 'Small' },
  { value: '3', label: 'Normal' },
  { value: '4', label: 'Large' },
  { value: '5', label: 'Larger' },
  { value: '6', label: 'Huge' },
] as const;

/**
 * The budget's assumptions as formatted text: headings, bold, bullets, size and colour. Saved
 * (cleaned to the safe subset the engine allows) a moment after typing stops and when the box is
 * left. Changes made elsewhere, e.g. by the AI, show here unless the box is being typed in.
 */
export function AssumptionsEditor(props: { value: string; onChange(html: string): void }) {
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  // Where the cursor was in the box, put back when a toolbar choice (e.g. a colour) took focus.
  const range = useRef<Range | null>(null);
  const { value, onChange } = props;

  useEffect(() => {
    const el = box.current;
    if (el && document.activeElement !== el && el.innerHTML !== value) el.innerHTML = value;
  }, [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const save = () => {
    window.clearTimeout(timer.current);
    const el = box.current;
    if (!el) return;
    const html = cleanAssumptions(el.innerHTML);
    if (html !== value) onChange(html);
  };
  const later = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, 800);
  };
  /** Runs an editing command on the selection, keeping it in the box. */
  const run = (command: string, arg?: string) => {
    const el = box.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (
      sel &&
      range.current &&
      !(sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer))
    ) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    }
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, arg);
    later();
  };
  // Buttons keep the selection: they don't take focus from the box.
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="assumptions-editor">
      <div className="assumptions-toolbar" role="toolbar" aria-label="Formatting">
        <select
          className="text-input"
          aria-label="Paragraph style"
          defaultValue=""
          onChange={(e) => {
            run('formatBlock', e.target.value);
            e.target.value = '';
          }}
        >
          <option value="" disabled>
            Style
          </option>
          {BLOCKS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
        <select
          className="text-input"
          aria-label="Text size"
          defaultValue=""
          onChange={(e) => {
            run('fontSize', e.target.value);
            e.target.value = '';
          }}
        >
          <option value="" disabled>
            Size
          </option>
          {SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="toolbar-sep" />
        <ToolButton label={`Bold (${keys('Ctrl+B')})`} onMouseDown={keep} onClick={() => run('bold')}>
          <b>B</b>
        </ToolButton>
        <ToolButton label={`Italic (${keys('Ctrl+I')})`} onMouseDown={keep} onClick={() => run('italic')}>
          <i>I</i>
        </ToolButton>
        <ToolButton
          label={`Underline (${keys('Ctrl+U')})`}
          onMouseDown={keep}
          onClick={() => run('underline')}
        >
          <u>U</u>
        </ToolButton>
        <ToolButton label="Strikethrough" onMouseDown={keep} onClick={() => run('strikeThrough')}>
          <s>S</s>
        </ToolButton>
        <span className="toolbar-sep" />
        <ToolButton label="Bullets" onMouseDown={keep} onClick={() => run('insertUnorderedList')}>
          • List
        </ToolButton>
        <ToolButton label="Numbered list" onMouseDown={keep} onClick={() => run('insertOrderedList')}>
          1. List
        </ToolButton>
        <span className="toolbar-sep" />
        <span className="assumptions-color">
          <ColorPick label="Text colour" value={null} onChange={(c) => run('foreColor', c ?? '#000000')} />
          <span className="muted small">Colour</span>
        </span>
        <span className="assumptions-color">
          <ColorPick
            label="Highlight"
            value={null}
            onChange={(c) => run('hiliteColor', c ?? 'transparent')}
          />
          <span className="muted small">Highlight</span>
        </span>
        <span className="toolbar-sep" />
        <ToolButton label="Clear formatting" onMouseDown={keep} onClick={() => run('removeFormat')}>
          Clear
        </ToolButton>
      </div>
      <div
        ref={box}
        className="assumptions-box assumptions"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Assumptions"
        data-placeholder="e.g. 40 shoot days in Atlanta, 5-day weeks. Union crew under current agreements…"
        onFocus={() => document.execCommand('defaultParagraphSeparator', false, 'p')}
        onInput={later}
        onBlur={(e) => {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) range.current = sel.getRangeAt(0).cloneRange();
          // Leaving for the toolbar (e.g. the colour popover) isn't leaving.
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) save();
        }}
      />
    </div>
  );
}

function ToolButton(props: {
  label: string;
  onClick(): void;
  onMouseDown(e: React.MouseEvent): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="btn btn-small"
      title={props.label}
      aria-label={props.label}
      onMouseDown={props.onMouseDown}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
