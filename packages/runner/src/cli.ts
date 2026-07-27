#!/usr/bin/env node
import path from 'node:path';
import { createRunnerServer, DEFAULT_ORIGINS, DEFAULT_PORT } from './server.js';

function parseArgs(argv: string[]): {
  port: number;
  origins: string[];
  terraformBin: string;
  dir: string;
} {
  let port = DEFAULT_PORT;
  const origins: string[] = [];
  let terraformBin = 'terraform';
  let dir = process.cwd();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') {
      port = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--origin') {
      origins.push(String(argv[i + 1]));
      i += 1;
    } else if (arg === '--terraform-bin') {
      terraformBin = String(argv[i + 1]);
      i += 1;
    } else if (arg === '--dir' || arg === '-d') {
      dir = path.resolve(String(argv[i + 1]));
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'archviz-runner — run terraform plan for Archviz Studio',
          '',
          'Start this inside the directory you export your Terraform to',
          '(or point at it with --dir), then click "Plan" in the studio.',
          '',
          'Options:',
          '  --dir, -d <path>        Terraform directory to plan in (default: current directory)',
          `  --port, -p <port>       Port to listen on (default ${DEFAULT_PORT})`,
          `  --origin <url>          Extra allowed studio origin (repeatable; defaults: ${DEFAULT_ORIGINS.join(', ')})`,
          '  --terraform-bin <path>  Terraform executable (default: terraform on PATH)',
        ].join('\n'),
      );
      process.exit(0);
    }
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`Invalid --port value`);
    process.exit(1);
  }
  return { port, origins: [...DEFAULT_ORIGINS, ...origins], terraformBin, dir };
}

const { port, origins, terraformBin, dir: cwd } = parseArgs(process.argv.slice(2));

const server = createRunnerServer({ cwd, origins, terraformBin });
server.listen(port, '127.0.0.1', () => {
  console.log('archviz-runner');
  console.log(`  directory : ${cwd}`);
  console.log(`  listening : http://127.0.0.1:${port}`);
  console.log(`  origins   : ${origins.join(', ')}`);
  console.log('');
  console.log('Open Archviz Studio and click "Plan" in the Terraform panel.');
});
server.on('error', (err) => {
  console.error(`Failed to start: ${err.message}`);
  process.exit(1);
});
