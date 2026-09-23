import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareIosProject } from './ios-project-name.mjs';

const defaultProjectPath = fileURLToPath(new URL('../src-tauri/gen/apple/resume-designer.xcodeproj/', import.meta.url));

function needsPreparation(args) {
  // Arguments after `--` belong to the runner, including any help flags.
  const separator = args.indexOf('--');
  const cliArgs = separator === -1 ? args : args.slice(0, separator);
  if (cliArgs.some(arg => ['-h', '--help', '-V', '--version'].includes(arg))) return false;
  const command = cliArgs.find(arg => arg !== '--verbose' && !/^-v+$/.test(arg));
  return ['build', 'dev', 'run'].includes(command);
}

export async function runIos(args, { projectPath = defaultProjectPath, invoke }) {
  // Tauri reads the configuration comments before its own build/dev hooks.
  // Repair Xcode's saved labels before handing control to the native CLI.
  if (needsPreparation(args)) prepareIosProject(projectPath);
  return invoke(['ios', ...args], 'npm run --');
}

async function main() {
  let cli;
  try {
    cli = createRequire(import.meta.url)('@tauri-apps/cli');
    await runIos(process.argv.slice(2), { invoke: cli.run });
  } catch (error) {
    if (cli) cli.logError(error.message);
    else console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
