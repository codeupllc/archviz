import type { HclAttribute, HclBlock, HclValue, FilePlan } from './ast.js';

function escapeString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function printValue(value: HclValue): string {
  switch (value.kind) {
    case 'string':
      return `"${escapeString(value.value)}"`;
    case 'number':
      return String(value.value);
    case 'boolean':
      return value.value ? 'true' : 'false';
    case 'null':
      return 'null';
    case 'traversal':
      return value.path.join('.');
    case 'raw':
      return value.code;
    case 'list':
      if (value.values.length === 0) return '[]';
      if (value.values.length === 1) return `[${printValue(value.values[0]!)}]`;
      return `[\n${value.values.map((v) => `    ${printValue(v)}`).join(',\n')}\n  ]`;
  }
}

function printAttributes(attrs: HclAttribute[], indent: string): string[] {
  if (attrs.length === 0) return [];
  const maxName = Math.max(...attrs.map((a) => a.name.length));
  return attrs.map((a) => {
    const pad = ' '.repeat(maxName - a.name.length);
    return `${indent}${a.name}${pad} = ${printValue(a.value)}`;
  });
}

function printBlock(block: HclBlock, indentLevel = 0): string {
  const indent = '  '.repeat(indentLevel);
  const labels = block.labels.map((l) => `"${escapeString(l)}"`).join(' ');
  const header = labels
    ? `${block.blockType} ${labels}`
    : block.blockType;

  const lines: string[] = [];
  if (block.comment) {
    for (const line of block.comment.split('\n')) {
      lines.push(`${indent}# ${line}`);
    }
  }
  lines.push(`${indent}${header} {`);

  const bodyIndent = '  '.repeat(indentLevel + 1);
  lines.push(...printAttributes(block.attributes, bodyIndent));

  for (const child of block.blocks) {
    if (lines[lines.length - 1] !== `${indent}${header} {`) {
      lines.push('');
    }
    lines.push(printBlock(child, indentLevel + 1));
  }

  lines.push(`${indent}}`);
  return lines.join('\n');
}

/** Print a list of blocks mimicking terraform fmt (2-space indent, aligned =). */
export function printHcl(blocks: HclBlock[]): string {
  return blocks.map((b) => printBlock(b)).join('\n\n') + (blocks.length ? '\n' : '');
}

export function printFilePlan(plan: FilePlan): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of plan.files) {
    out[file.path] = printHcl(file.blocks);
  }
  return out;
}
