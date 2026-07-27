import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * The browser sends a map of relative file paths to contents. The runner
 * writes them into its working directory (the user's exported Terraform
 * folder), so paths coming over the wire are a trust boundary: reject
 * anything that could escape the directory or clobber terraform's own
 * internals before touching the filesystem.
 */
export function assertSafeRelativePath(filePath: string): void {
  if (!filePath || filePath.trim() === '') {
    throw new Error('empty file path');
  }
  if (path.isAbsolute(filePath) || /^[a-zA-Z]:[\\/]/.test(filePath)) {
    throw new Error(`absolute paths are not allowed: ${filePath}`);
  }
  const segments = filePath.split(/[\\/]/);
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`unsafe path segment in: ${filePath}`);
    }
    if (segment === '.terraform' || segment === '.git') {
      throw new Error(`writing into ${segment}/ is not allowed: ${filePath}`);
    }
  }
}

/** Validates every path up front, then writes all files (creating subdirectories). */
export async function writeGeneratedFiles(
  cwd: string,
  files: Record<string, string>,
): Promise<string[]> {
  const entries = Object.entries(files);
  for (const [filePath] of entries) {
    assertSafeRelativePath(filePath);
  }
  const written: string[] = [];
  for (const [filePath, content] of entries) {
    const target = path.join(cwd, filePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
    written.push(filePath);
  }
  return written;
}
