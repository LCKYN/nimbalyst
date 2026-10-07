/**
 * Reorder `paths` to follow `order`, the rail order the user dragged the
 * projects into. Paths listed in `order` come first, in that order; any
 * other paths keep their relative order and go at the end. Entries in
 * `order` that are not in `paths` are ignored, so the result is always a
 * permutation of `paths`.
 *
 * Lives outside `MultiProjectRailHandlers` so `WindowHandlers` can use it
 * without importing the handlers' service graph.
 */
export function applyRailOrder(paths: string[], order: string[] | undefined): string[] {
  if (!order || order.length === 0) return paths;
  const remaining = new Set(paths);
  const result: string[] = [];
  for (const path of order) {
    if (remaining.delete(path)) result.push(path);
  }
  for (const path of paths) {
    if (remaining.delete(path)) result.push(path);
  }
  return result;
}
