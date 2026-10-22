import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BUDGET_TOOLS } from '@fringe/budget-engine';
import { type WebContents, app } from 'electron';
import { type IPty, spawn } from 'node-pty';
import { IpcChannel, type TerminalStart } from '../shared/ipc';
import { projectsRoot, writeAtomic } from './projects';

/**
 * The terminal in the app's side panel. It runs the user's own shell and starts Claude Code in it,
 * pointed at the app's MCP server. Claude Code is Anthropic's app: the user signs in to it with
 * their own Claude plan, and Fringe never sees that sign-in. Nothing is added to the user's own
 * Claude Code settings; the server is passed for this run only (--mcp-config).
 *
 * One terminal for the app. It keeps running while the panel is hidden.
 */

let pty: IPty | null = null;
let output: WebContents | null = null;

/** The MCP settings Claude Code reads for this run. Holds the token, so it lives in app data. */
async function writeMcpConfig(url: string, token: string): Promise<string> {
  const file = join(app.getPath('userData'), 'claude-mcp.json');
  const config = {
    mcpServers: { fringe: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } },
  };
  await writeAtomic(file, JSON.stringify(config, null, 2));
  return file;
}

/** Reading tools run without asking each time; Claude Code asks before every edit. */
function claudeCommand(configFile: string): string {
  const reads = BUDGET_TOOLS.filter((t) => !t.edits)
    .map((t) => `mcp__fringe__${t.name}`)
    .join(',');
  return `claude --mcp-config "${configFile}" --allowedTools "${reads}"`;
}

function shellFor(platform: NodeJS.Platform): { file: string; args: string[] } {
  // cmd rather than PowerShell on Windows: npm's claude.ps1 is refused under the default
  // script policy, and cmd finds claude.cmd.
  if (platform === 'win32') return { file: process.env['ComSpec'] ?? 'cmd.exe', args: [] };
  return { file: process.env['SHELL'] ?? '/bin/bash', args: ['-l'] };
}

/**
 * Starts the terminal for this window (or hands an already running one to it) and types the
 * Claude Code command. The MCP server must already be running.
 */
export async function startTerminal(
  contents: WebContents,
  size: TerminalStart,
  mcp: { url: string; token: string },
): Promise<void> {
  output = contents;
  if (pty) {
    pty.resize(size.cols, size.rows);
    return;
  }
  const cwd = projectsRoot();
  await mkdir(cwd, { recursive: true });
  const configFile = await writeMcpConfig(mcp.url, mcp.token);
  const { file, args } = shellFor(process.platform);
  const p = spawn(file, args, {
    name: 'xterm-256color',
    cols: size.cols,
    rows: size.rows,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>,
  });
  pty = p;
  p.onData((data) => {
    if (output && !output.isDestroyed()) output.send(IpcChannel.terminalData, data);
  });
  p.onExit(({ exitCode }) => {
    if (pty === p) pty = null;
    if (output && !output.isDestroyed()) output.send(IpcChannel.terminalExit, exitCode);
  });
  p.write(`${claudeCommand(configFile)}\r`);
}

export function writeTerminal(data: string): void {
  pty?.write(data);
}

export function resizeTerminal(cols: number, rows: number): void {
  if (pty && cols > 0 && rows > 0) pty.resize(cols, rows);
}

export function stopTerminal(): void {
  const p = pty;
  pty = null;
  p?.kill();
}
