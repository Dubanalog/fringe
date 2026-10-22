/** Whether the app runs on a Mac, where Ctrl shortcuts are pressed with ⌘. */
export const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);

/**
 * A shortcut as the system writes it: "Ctrl+Z" stays on Windows and Linux and is "⌘Z" on a Mac.
 * Ctrl+Tab stays Ctrl on a Mac too (⌘Tab is the system's).
 */
export function keys(shortcut: string): string {
  if (!isMac || /^Ctrl\+(Shift\+)?Tab$/.test(shortcut)) return shortcut;
  // Redo is ⇧⌘Z on a Mac.
  return (shortcut === 'Ctrl+Y' ? 'Ctrl+Shift+Z' : shortcut)
    .replace(/Ctrl\+/g, '⌘')
    .replace(/Shift\+/g, '⇧')
    .replace(/Alt\+/g, '⌥');
}
