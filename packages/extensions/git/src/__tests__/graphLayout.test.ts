// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { laneColorIndex, layoutCommitGraph } from '../graphLayout';

describe('layoutCommitGraph', () => {
  it('keeps an independent branch in its own lane until it rejoins history', () => {
    const layout = layoutCommitGraph([
      { hash: 'main-tip', parents: ['main-parent'] },
      { hash: 'feature-tip', parents: ['feature-base'] },
      { hash: 'main-parent', parents: ['feature-base'] },
      { hash: 'feature-base', parents: [] },
    ]);

    expect(layout.map(({ hash, lane, parentLanes }) => ({ hash, lane, parentLanes }))).toEqual([
      { hash: 'main-tip', lane: 0, parentLanes: [0] },
      { hash: 'feature-tip', lane: 1, parentLanes: [1] },
      { hash: 'main-parent', lane: 0, parentLanes: [0] },
      { hash: 'feature-base', lane: 0, parentLanes: [] },
    ]);
  });

  it('draws every merge parent from the commit lane', () => {
    const [merge] = layoutCommitGraph([
      { hash: 'merge', parents: ['main-parent', 'feature-parent'] },
      { hash: 'main-parent', parents: [] },
      { hash: 'feature-parent', parents: [] },
    ]);

    expect(merge.lane).toBe(0);
    expect(merge.parentLanes).toEqual([0, 1]);
    expect(merge.laneCount).toBe(2);
  });

  it('spreads an octopus merge across as many adjacent lanes as it has parents', () => {
    const [merge] = layoutCommitGraph([
      { hash: 'merge', parents: ['p1', 'p2', 'p3'] },
      { hash: 'p1', parents: [] },
      { hash: 'p2', parents: [] },
      { hash: 'p3', parents: [] },
    ]);

    expect(merge.lane).toBe(0);
    expect(merge.parentLanes).toEqual([0, 1, 2]);
    expect(merge.laneCount).toBe(3);
  });
});

describe('laneColorIndex', () => {
  it('is stable for a given hash regardless of which column it is computed for', () => {
    const first = laneColorIndex('abc123', 6);
    const second = laneColorIndex('abc123', 6);
    expect(first).toBe(second);
  });

  it('keeps a branch colorKey unchanged when a sibling lane to its left terminates', () => {
    // Two branches open side by side (A in lane 0, B in lane 1); once A's
    // parent terminates, B's remaining lane collapses left from column 1 to
    // column 0.
    const layout = layoutCommitGraph([
      { hash: 'A-tip', parents: ['A-parent'] },
      { hash: 'B-tip', parents: ['B-parent'] },
      { hash: 'A-parent', parents: [] },
      { hash: 'B-parent', parents: [] },
    ]);

    const bTip = layout.find(row => row.hash === 'B-tip')!;
    const bParent = layout.find(row => row.hash === 'B-parent')!;

    // Column index shifts (B moves from lane 1 to lane 0)...
    expect(bTip.lane).toBe(1);
    expect(bParent.lane).toBe(0);

    // ...but the branch's color identity does not, since it's keyed to the
    // branch's origin rather than its current column.
    expect(bParent.colorKey).toBe(bTip.colorKey);
    expect(laneColorIndex(bTip.colorKey, 6)).toBe(laneColorIndex(bParent.colorKey, 6));
  });
});
