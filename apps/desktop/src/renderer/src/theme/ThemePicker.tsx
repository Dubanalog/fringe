import { useTheme } from './ThemeProvider';
import { THEMES, type ThemePreference } from './themes';

export function ThemePicker() {
  const { preference, setPreference } = useTheme();
  const options: { id: ThemePreference; label: string; swatch?: readonly string[] }[] = [
    { id: 'system', label: 'Match system' },
    ...THEMES.map((t) => ({ id: t.id, label: t.label, swatch: t.swatch })),
  ];

  return (
    <div className="theme-picker" role="radiogroup" aria-label="Theme">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="radio"
          aria-checked={preference === opt.id}
          className="theme-option"
          onClick={() => setPreference(opt.id)}
        >
          <span className="theme-swatch" aria-hidden="true">
            {(opt.swatch ?? ['#f7f7f5', '#16181d', '#7a7f8c']).map((c) => (
              <span key={c} style={{ background: c }} />
            ))}
          </span>
          {opt.label}
        </button>
      ))}
    </div>
  );
}
