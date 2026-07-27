import type { HclAttribute, HclBlock, HclValue, FilePlan } from './ast.js';

function escapeString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * `indent` is the leading whitespace of the line the value starts on, so
 * multi-line values (lists) can indent their items relative to their actual
 * nesting depth the way `terraform fmt` does.
 */
function printValue(value: HclValue, indent = ''): string {
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
    case 'list': {
      if (value.values.length === 0) return '[]';
      if (value.values.length === 1) return `[${printValue(value.values[0]!, indent)}]`;
      const itemIndent = `${indent}  `;
      const items = value.values
        .map((v) => `${itemIndent}${printValue(v, itemIndent)}`)
        .join(',\n');
      return `[\n${items}\n${indent}]`;
    }
  }
}

/**
 * Mirrors `terraform fmt`: `=` signs are aligned within runs of consecutive
 * single-line attributes, while an attribute whose value spans several lines
 * (a jsonencode(...) blob, an inline object) gets a single space and breaks
 * the run.
 */
function printAttributes(attrs: HclAttribute[], indent: string): string[] {
  if (attrs.length === 0) return [];

  const rendered = attrs.map((a) => ({ name: a.name, text: printValue(a.value, indent) }));
  const lines: string[] = [];
  let run: { name: string; text: string }[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    const maxName = Math.max(...run.map((a) => a.name.length));
    for (const a of run) {
      lines.push(`${indent}${a.name}${' '.repeat(maxName - a.name.length)} = ${a.text}`);
    }
    run = [];
  };

  for (const attr of rendered) {
    if (attr.text.includes('\n')) {
      flushRun();
      lines.push(`${indent}${attr.name} = ${attr.text}`);
    } else {
      run.push(attr);
    }
  }
  flushRun();

  return lines;
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
