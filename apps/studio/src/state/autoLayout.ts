import type { ArchvizDocument, ResourceInstance, ResourceLayout } from '@archviz/core';
import type { ResourceRegistry } from '@archviz/schema';

const LEAF_W = 160;
const LEAF_H = 80;
const MIN_CONTAINER_W = 320;
const MIN_CONTAINER_H = 200;
/** Room for the container's header row before children start. */
const PAD_TOP = 64;
const PAD = 36;
const GAP = 48;
const ROOT_X = 60;
const ROOT_Y = 60;
const ROOT_GAP = 90;

/**
 * Deterministic "auto-arrange": recursively packs each container's children
 * into rows (roughly square overall), sizes containers to fit their content,
 * then lays the top-level nodes out in the same row-packing fashion.
 *
 * Returns parent-relative layouts for every resource (matching how layouts
 * are stored in the document). Intentionally ignores current positions so
 * repeated clicks always converge to the same tidy arrangement.
 */
export function computeAutoLayout(
  document: ArchvizDocument,
  registry: ResourceRegistry,
): Record<string, ResourceLayout> {
  const result: Record<string, ResourceLayout> = {};

  const childrenOf = (parentId: string | null): ResourceInstance[] =>
    document.resources.filter((r) => (r.parentId ?? null) === parentId);

  const isContainer = (r: ResourceInstance): boolean =>
    registry.get(r.type)?.display.kind === 'container';

  /**
   * Packs `items` (whose sizes are known) into rows. Mutates `result` with
   * positions relative to (startX, startY) and returns the bounding size.
   */
  function packRows(
    items: { resource: ResourceInstance; width: number; height: number }[],
    startX: number,
    startY: number,
    gap: number,
  ): { width: number; height: number } {
    if (items.length === 0) return { width: 0, height: 0 };

    // Big things (containers) first: rows pack much cleaner when heights
    // within a row are similar. Stable sort keeps document order otherwise.
    const sorted = [...items].sort(
      (a, b) => b.height * b.width - a.height * a.width,
    );
    const perRow = Math.ceil(Math.sqrt(sorted.length));

    let x = startX;
    let y = startY;
    let rowHeight = 0;
    let maxRowWidth = 0;
    let inRow = 0;

    for (const item of sorted) {
      if (inRow >= perRow) {
        maxRowWidth = Math.max(maxRowWidth, x - gap - startX);
        x = startX;
        y += rowHeight + gap;
        rowHeight = 0;
        inRow = 0;
      }
      result[item.resource.id] = {
        x,
        y,
        width: item.width,
        height: item.height,
      };
      x += item.width + gap;
      rowHeight = Math.max(rowHeight, item.height);
      inRow += 1;
    }
    maxRowWidth = Math.max(maxRowWidth, x - gap - startX);

    return { width: maxRowWidth, height: y + rowHeight - startY };
  }

  /** Computes a resource's size, laying out its children in the process. */
  function layoutSubtree(resource: ResourceInstance): { width: number; height: number } {
    if (!isContainer(resource)) {
      // Leaves keep any size the user gave them; only their position is managed.
      return {
        width: resource.layout.width ?? LEAF_W,
        height: resource.layout.height ?? LEAF_H,
      };
    }

    const kids = childrenOf(resource.id);
    const sized = kids.map((kid) => ({ resource: kid, ...layoutSubtree(kid) }));
    const content = packRows(sized, PAD, PAD_TOP, GAP);

    return {
      width: Math.max(MIN_CONTAINER_W, content.width + PAD * 2),
      height: Math.max(MIN_CONTAINER_H, PAD_TOP + content.height + PAD),
    };
  }

  const roots = childrenOf(null);
  const sizedRoots = roots.map((root) => ({ resource: root, ...layoutSubtree(root) }));
  packRows(sizedRoots, ROOT_X, ROOT_Y, ROOT_GAP);

  return result;
}
