#!/usr/bin/env node
import { startServer } from './dashboard-server.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const command = args[0];

if (command === 'dashboard') {
  const portArg = args.find(a => a.startsWith('--port='))?.slice('--port='.length);
  const port = portArg ? Number(portArg) : 7654;
  const noOpen = args.includes('--no-open');
  const cwdArg = args.find(a => a.startsWith('--cwd='))?.slice('--cwd='.length);
  const cwd = cwdArg ? resolve(cwdArg) : process.cwd();
  void runDashboard({ port, noOpen, cwd });
} else if (command === '--help' || command === '-h' || !command) {
  printHelp();
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

async function runDashboard({ port, noOpen, cwd }: { port: number; noOpen: boolean; cwd: string }): Promise<void> {
  const here = fileURLToPath(import.meta.url);
  const staticDir = resolve(here, '../../dashboard');
  const handle = await startServer({ port, cwd, staticDir: existsSync(staticDir) ? staticDir : undefined });
  console.log(`rxjs-leak-finder dashboard listening at ${handle.url}`);
  console.log(`Reports will be saved to ${cwd}/.rld/`);
  if (!noOpen) {
    await openInBrowser(handle.url);
  }
  // Keep alive
  process.on('SIGINT', async () => {
    console.log('\nShutting down…');
    await handle.close();
    process.exit(0);
  });
}

async function openInBrowser(url: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
}

function printHelp(): void {
  console.log(`
rxjs-leak-finder — local dashboard for RxJS subscription leaks

Usage:
  npx rxjs-leak-finder dashboard [options]

Options:
  --port=<n>     Port to listen on (default 7654)
  --cwd=<path>   Where to write .rld/ session files (default cwd)
  --no-open      Don't auto-open the browser
  --help, -h     Show this help

Environment:
  RLD_EDITOR     Editor launcher for "open in editor" links.
                 Recognized: code, cursor, idea, webstorm, pycharm,
                 phpstorm, goland, rubymine, subl, vim, nvim, emacs.
                 Defaults to 'code'.
`.trim());
}
