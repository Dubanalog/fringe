import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  EditError,
  type LibraryFringe,
  libraryFile,
  mergeIntoLibrary,
  parseFringeLibrary,
} from '@fringe/budget-engine';
import {
  BrowserWindow,
  type OpenDialogOptions,
  type SaveDialogOptions,
  app,
  dialog,
  ipcMain,
} from 'electron';
import { type ImportLibraryResult, IpcChannel, type SaveReportResult } from '../shared/ipc';
import { writeAtomic } from './projects';

// The fringe rate library: the user's own rates, on this computer, shared as a JSON file.

const libraryPath = () => join(app.getPath('userData'), 'fringe-library.json');

export async function fringeLibrary(): Promise<LibraryFringe[]> {
  let text: string;
  try {
    text = await readFile(libraryPath(), 'utf8');
  } catch {
    return [];
  }
  return parseFringeLibrary(JSON.parse(text));
}

async function saveLibrary(fringes: readonly LibraryFringe[]): Promise<void> {
  await writeAtomic(libraryPath(), JSON.stringify(libraryFile(fringes), null, 2));
}

const message = (err: unknown, fallback: string) =>
  err instanceof EditError || err instanceof SyntaxError ? err.message : fallback;

export function registerFringeLibraryIpc(): void {
  ipcMain.handle(IpcChannel.fringeLibrary, () => fringeLibrary());

  // The renderer sends the whole library; it's checked the same way as an imported file.
  ipcMain.handle(IpcChannel.saveFringeLibrary, async (_event, fringes: unknown) => {
    const checked = parseFringeLibrary({ ...libraryFile([]), fringes });
    await saveLibrary(checked);
    return checked;
  });

  ipcMain.handle(IpcChannel.exportFringeLibrary, async (event): Promise<SaveReportResult | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: SaveDialogOptions = {
      title: 'Export fringe rates',
      defaultPath: join(app.getPath('documents'), 'Fringe Rates.json'),
      filters: [{ name: 'Fringe rate library', extensions: ['json'] }],
    };
    const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (picked.canceled || !picked.filePath) return null;
    let file = picked.filePath;
    if (extname(file).toLowerCase() !== '.json') file += '.json';
    try {
      await writeAtomic(file, JSON.stringify(libraryFile(await fringeLibrary()), null, 2));
      return { ok: true, file };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Couldn't save the rates." };
    }
  });

  // Rates in the file are added; ones with a name already in the library replace it.
  ipcMain.handle(IpcChannel.importFringeLibrary, async (event): Promise<ImportLibraryResult | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: 'Import fringe rates',
      defaultPath: app.getPath('documents'),
      filters: [
        { name: 'Fringe rate library', extensions: ['json'] },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return null;
    try {
      const incoming = parseFringeLibrary(JSON.parse(await readFile(file, 'utf8')));
      const merged = mergeIntoLibrary(await fringeLibrary(), incoming);
      await saveLibrary(merged.library);
      return { ok: true, ...merged };
    } catch (err) {
      return { ok: false, error: message(err, "Couldn't read that file.") };
    }
  });
}
