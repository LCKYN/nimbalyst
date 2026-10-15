// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@nimbalyst/runtime/store';
import { sessionLaunchPopupRequestAtom } from '../../atoms/appCommands';
import { activeExtensionPanelAtom } from '../../atoms/extensionPanels';
import { initAppCommandListeners } from '../appCommandListeners';

vi.mock('../../../extensions/panels/PanelRegistry', () => ({
  getPanelById: (id: string) => (id === 'com.nimbalyst.ai-usage.report' ? { id } : undefined),
}));

describe('session launch popup app command', () => {
  let cleanup: (() => void) | undefined;
  let handlers: Record<string, (...args: unknown[]) => void>;

  beforeEach(() => {
    handlers = {};
    store.set(sessionLaunchPopupRequestAtom, 0);
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          handlers[event] = handler;
          return () => delete handlers[event];
        }),
      },
    });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('increments the command atom when main opens the popup', () => {
    cleanup = initAppCommandListeners();
    handlers['session-launch-popup-open']();
    expect(store.get(sessionLaunchPopupRequestAtom)).toBe(1);
  });

  it('opens a registered extension panel and ignores an unknown one', () => {
    cleanup = initAppCommandListeners();
    store.set(activeExtensionPanelAtom, null);
    handlers['open-extension-panel']('com.nimbalyst.disabled.panel');
    expect(store.get(activeExtensionPanelAtom)).toBeNull();
    handlers['open-extension-panel']('com.nimbalyst.ai-usage.report');
    expect(store.get(activeExtensionPanelAtom)).toBe('com.nimbalyst.ai-usage.report');
  });
});
