#!/usr/bin/env node
import path from 'node:path';
import { createRunnerServer, DEFAULT_ORIGINS, DEFAULT_PORT } from './server.js';
import { loadRunnerEnv } from './load-env.js';

const envFiles = loadRunnerEnv();

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
          'archviz-runner — terraform plan + LocalStack apply for Archviz Studio',
          '',
          'Start this inside the directory you export your Terraform to',
          '(or point at it with --dir), then use Plan / LocalStack in the studio.',
          '',
          'LocalStack:',
          '  Default image localstack/localstack:4.14.0 (no auth token).',
          '  Put LOCALSTACK_AUTH_TOKEN / LOCALSTACK_IMAGE in repo .env or the environment.',
          '  Optional LOCALSTACK_ENDPOINT (default http://127.0.0.1:4566).',
          '  See docs/localstack.md',
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

const lsImage = process.env.LOCALSTACK_IMAGE?.trim() || 'localstack/localstack:4.14.0';
const hasLsToken = Boolean(process.env.LOCALSTACK_AUTH_TOKEN?.trim());

const server = createRunnerServer({ cwd, origins, terraformBin });
server.listen(port, '127.0.0.1', () => {
  console.log('archviz-runner');
  console.log(`  directory : ${cwd}`);
  console.log(`  listening : http://127.0.0.1:${port}`);
  console.log(`  origins   : ${origins.join(', ')}`);
  if (envFiles.length > 0) {
    console.log(`  env       : ${envFiles.join(', ')}`);
  }
  console.log(`  localstack: ${lsImage}${hasLsToken ? ' (+ LOCALSTACK_AUTH_TOKEN)' : ''}`);
  console.log('');
  console.log('Open Archviz Studio: Plan (real AWS credentials) or LocalStack Apply (emulated).');
});
server.on('error', (err) => {
  console.error(`Failed to start: ${err.message}`);
  process.exit(1);
});
