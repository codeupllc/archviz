#!/usr/bin/env node
/**
 * Writes the LocalStack Hobby fixture (Lambda + DynamoDB) under
 * fixtures/localstack-hobby/terraform/, plus a minimal function.zip so
 * `terraform apply` against LocalStack can create the Lambda.
 *
 * Usage:
 *   node scripts/write-localstack-hobby-fixture.mjs [outDir]
 *
 * Then (with Docker + archviz-runner, or manually):
 *   cd fixtures/localstack-hobby/terraform
 *   # after LocalStack is up on :4566 with providers_localstack override —
 *   # prefer Studio "LocalStack Apply" or the runner API.
 */
import { mkdirSync, rmSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAwsRegistry } from '@archviz/provider-aws';
import { generate, buildLocalstackHobbyDocument } from '@archviz/codegen';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(process.argv[2] ?? path.join(root, 'fixtures/localstack-hobby/terraform'));
const fixtureRoot = path.dirname(outDir);

const registry = createAwsRegistry();
const doc = buildLocalstackHobbyDocument();
const result = generate(doc, registry, { layout: 'by-category' });

if (result.blocked) {
  console.error('Fixture is blocked by validation errors:');
  for (const d of result.diagnostics.filter((x) => x.severity === 'error')) {
    console.error(`  - [${d.code}] ${d.message}`);
  }
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const [file, content] of Object.entries(result.files)) {
  writeFileSync(path.join(outDir, file), content);
}

// Minimal Node Lambda zip (index.js → handler index.handler)
const zipStaging = path.join(fixtureRoot, '.zip-staging');
rmSync(zipStaging, { recursive: true, force: true });
mkdirSync(zipStaging, { recursive: true });
writeFileSync(
  path.join(zipStaging, 'index.js'),
  'exports.handler = async () => ({ statusCode: 200, body: "ok" });\n',
);
execFileSync('zip', ['-q', '-r', path.join(outDir, 'function.zip'), 'index.js'], {
  cwd: zipStaging,
});
rmSync(zipStaging, { recursive: true, force: true });

writeFileSync(
  path.join(fixtureRoot, 'diagram.json'),
  `${JSON.stringify(doc, null, 2)}\n`,
);

const readme = `# LocalStack Hobby fixture

Minimal **Lambda + DynamoDB + IAM** diagram for free LocalStack Hobby apply.

## Generate Terraform

\`\`\`bash
node scripts/write-localstack-hobby-fixture.mjs
\`\`\`

Writes \`terraform/\` (HCL + \`function.zip\`) and \`diagram.json\`.

## Apply via Studio

1. \`pnpm runner\` (Docker required for LocalStack)
2. Open Studio, import or recreate this diagram
3. Click **LocalStack Apply** (Hobby allowlist must pass)

## Manual note

ECS / RDS diagrams are **not** Hobby — see [docs/localstack.md](../../docs/localstack.md).
`;
writeFileSync(path.join(fixtureRoot, 'README.md'), readme);

console.log(`Wrote ${Object.keys(result.files).length} tf files + function.zip to ${outDir}`);
if (!existsSync(path.join(outDir, 'function.zip'))) {
  console.error('function.zip missing — is `zip` on PATH?');
  process.exit(1);
}
