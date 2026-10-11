// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { store } from '@nimbalyst/runtime/store';
import { activeWorkspacePathAtom } from '../openProjects';
import {
  clampAgentRightPanelWidth,
  initAgentModeLayout,
  MIN_AGENT_MAIN_PANEL_WIDTH,
  MIN_AGENT_RIGHT_PANEL_WIDTH,
  SESSION_HISTORY_WIDTH_KEY,
  sessionHistoryWidthAtom,
  setSessionHistoryWidthAtom,
} from '../agentMode';

describe('session history width', () => {
  it('is shared across projects and persisted globally', async () => {
    const appSettings = new Map<string, unknown>();
    const workspaceWidths: Record<string, number> = { '/a': 300, '/b': 420 };
    vi.stubGlobal('window', {
      electronAPI: {
        invoke: vi.fn(async (channel: string, key: string, value?: unknown) => {
          if (channel === 'workspace:get-state') {
            return { agenticCodingWindowState: { sessionHistoryLayout: { width: workspaceWidths[key] } } };
          }
          if (channel === 'app-settings:get') return appSettings.get(key);
          if (channel === 'app-settings:set') appSettings.set(key, value);
          return undefined;
        }),
      },
    });

    // Projects saved different widths before the width went global; the first loaded wins.
    await initAgentModeLayout('/a');
    await initAgentModeLayout('/b');
    expect(store.get(sessionHistoryWidthAtom)).toBe(300);

    store.set(setSessionHistoryWidthAtom, 360);
    store.set(activeWorkspacePathAtom, '/a');
    expect(store.get(sessionHistoryWidthAtom)).toBe(360);
    await vi.waitFor(() => expect(appSettings.get(SESSION_HISTORY_WIDTH_KEY)).toBe(360));
    vi.unstubAllGlobals();
  });
});

describe('clampAgentRightPanelWidth', () => {
  it('allows the right panel to occupy all but the reserved main-panel strip', () => {
    expect(clampAgentRightPanelWidth(2_000, 1_200)).toBe(
      1_200 - MIN_AGENT_MAIN_PANEL_WIDTH,
    );
  });

  it('preserves widths inside the available range', () => {
    expect(clampAgentRightPanelWidth(840, 1_200)).toBe(840);
  });

  it('retains the minimum usable right-panel width', () => {
    expect(clampAgentRightPanelWidth(40, 1_200)).toBe(MIN_AGENT_RIGHT_PANEL_WIDTH);
  });
});
