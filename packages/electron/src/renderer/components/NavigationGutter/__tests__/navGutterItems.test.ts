// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  sortBySavedOrder,
  canHideGutterItem,
  isModeLevelPanel,
  insertAboveTracker,
  type GutterItemMeta,
} from '../navGutterItems';

describe('sortBySavedOrder', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('returns items unchanged when there is no saved order', () => {
    expect(sortBySavedOrder(items, undefined).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(sortBySavedOrder(items, []).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('applies the saved order', () => {
    expect(sortBySavedOrder(items, ['c', 'a', 'b']).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('sends items missing from the saved order to the end, preserving their relative order', () => {
    // 'b' unknown -> falls to the end; 'a','c' follow saved order.
    expect(sortBySavedOrder(items, ['c', 'a']).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps multiple unknown items in their original relative order (stable)', () => {
    const four = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    // only 'c' is ranked; a,b,d are unknown and must stay a<b<d.
    expect(sortBySavedOrder(four, ['c']).map((i) => i.id)).toEqual(['c', 'a', 'b', 'd']);
  });
});

describe('canHideGutterItem', () => {
  const meta = (id: string, section: GutterItemMeta['section'], hideable = true): GutterItemMeta => ({
    id, section, icon: 'x', label: id, hideable,
  });

  it('never allows hiding a non-hideable item', () => {
    expect(canHideGutterItem('user', meta('user', 'indicators', false), [], [])).toBe(false);
  });

  it('always allows hiding a non-mode item', () => {
    expect(canHideGutterItem('sync', meta('sync', 'indicators'), ['files', 'agent'], [])).toBe(true);
  });

  it('allows hiding a mode when others remain visible', () => {
    expect(canHideGutterItem('agent', meta('agent', 'modes'), ['files', 'agent', 'tracker'], [])).toBe(true);
  });

  it('blocks hiding the last remaining visible mode', () => {
    // files + agent already hidden -> tracker is the only visible mode.
    expect(
      canHideGutterItem('tracker', meta('tracker', 'modes'), ['files', 'agent', 'tracker'], ['files', 'agent']),
    ).toBe(false);
  });

  it('allows hiding a mode that is not the last one even when some are hidden', () => {
    expect(
      canHideGutterItem('agent', meta('agent', 'modes'), ['files', 'agent', 'tracker'], ['files']),
    ).toBe(true);
  });
});

describe('mode-level extension panels', () => {
  it('treats only a fullscreen panel with a negative order as mode-level', () => {
    expect(isModeLevelPanel({ placement: 'fullscreen', order: -1 })).toBe(true);
    expect(isModeLevelPanel({ placement: 'fullscreen', order: 100 })).toBe(false);
    expect(isModeLevelPanel({ placement: 'sidebar', order: -1 })).toBe(false);
  });

  it('inserts them directly above Tracker, or last when Tracker is unavailable', () => {
    const ids = (items: { id: string }[]) => items.map((i) => i.id);
    const panels = [{ id: 'ext.board' }];
    expect(ids(insertAboveTracker([{ id: 'files' }, { id: 'agent' }, { id: 'tracker' }, { id: 'collab' }], panels)))
      .toEqual(['files', 'agent', 'ext.board', 'tracker', 'collab']);
    expect(ids(insertAboveTracker([{ id: 'files' }, { id: 'agent' }], panels))).toEqual(['files', 'agent', 'ext.board']);
  });
});
