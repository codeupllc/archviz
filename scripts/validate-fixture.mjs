#!/usr/bin/env node
/**
 * Generates the all-resources fixture and runs `terraform validate` on it, so
 * CI (and anyone locally) catches required Terraform arguments that our
 * resource definitions fail to emit.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createAwsRegistry } from '@archviz/provider-aws';
import { generate, buildAllResourcesDocument } from '@archviz/codegen';

const outDir = process.argv[2] ?? 'tmp/tf-fixture';
const registry = createAwsRegistry();
const doc = buildAllResourcesDocument();
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
console.log(`Wrote ${Object.keys(result.files).length} files to ${outDir}`);

const run = (args) =>
  execFileSync('terraform', args, { cwd: outDir, stdio: 'inherit', env: process.env });

run(['init', '-backend=false', '-input=false', '-no-color']);
run(['validate', '-no-color']);
run(['fmt', '-check', '-diff', '-no-color']);
console.log('terraform validate + fmt passed');
