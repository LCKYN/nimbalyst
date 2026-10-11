import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectRail } from '../ProjectRail';
import { activeWorkspacePathAtom, multiProjectModeAtom, openProjectsAtom } from '../../store/atoms/openProjects';

vi.mock('@nimbalyst/runtime', () => ({ getShowInFileBrowserLabel: () => 'Show in Finder' }));
vi.mock('../OrgSwitcher', () => ({ OrgSwitcher: () => null }));
vi.mock('../WorkspaceSummaryHeader', () => ({ generateWorkspaceAccentColor: () => '#123456' }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('reveals restored and newly selected projects, handles resize, and leaves manual scrolling alone', () => {
  const store = createStore();
  const projects = Array.from({ length: 32 }, (_, i) => ({ path: `/p/${i}`, name: `Project ${i}`, openedAt: i }));
  store.set(multiProjectModeAtom, true);
  store.set(openProjectsAtom, projects);
  store.set(activeWorkspacePathAtom, projects[31].path);
  let height = 400;
  let resized = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    if (this.classList.contains('project-rail-projects')) return { top: 100, bottom: 100 + height } as DOMRect;
    if (this.classList.contains('project-rail-item')) {
      const index = Number(this.dataset.projectPath!.split('/').pop());
      const list = this.closest('.project-rail-projects')!;
      const top = 104 + index * 48 - list.scrollTop;
      return { top, bottom: top + 40 } as DOMRect;
    }
    return { top: 0, bottom: 0 } as DOMRect;
  });
  const tree = <Provider store={store}><ProjectRail /></Provider>;
  const view = render(tree);
  const list = view.getByTestId('project-rail-projects');
  const visible = (index: number) => {
    const item = view.getByRole('button', { name: `Switch to project Project ${index}` }).parentElement!;
    expect(item.getBoundingClientRect().top).toBeGreaterThanOrEqual(100);
    expect(item.getBoundingClientRect().bottom).toBeLessThanOrEqual(100 + height);
  };
  visible(31);
  act(() => store.set(activeWorkspacePathAtom, projects[0].path));
  visible(0);
  act(() => store.set(activeWorkspacePathAtom, projects[31].path));
  visible(31);
  act(() => { height = 200; resized(); });
  visible(31);
  list.scrollTop = 0; // Browsing other projects must not snap back to the selection.
  view.rerender(<Provider store={store}><ProjectRail /></Provider>);
  expect(list.scrollTop).toBe(0);
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
});

it('replaces initials with a picked emoji and restores them on reset', async () => {
  const store = createStore();
  store.set(multiProjectModeAtom, true);
  store.set(openProjectsAtom, [{ path: '/p/app', name: 'poc-app', openedAt: 0 }]);
  let saved: string | null = null;
  const colors: Record<string, string> = {};
  const invoke = vi.fn(async (channel: string, data?: { icon?: string | null; slot?: string; color?: string | null }) => {
    if (channel === 'workspace:set-icon') saved = data?.icon ?? null;
    if (channel === 'workspace:get-icon') return saved;
    if (channel === 'workspace:set-color') {
      if (data?.color) colors[data.slot!] = data.color;
      else delete colors[data!.slot!];
    }
    if (channel === 'workspace:get-colors') return { ...colors };
    return null;
  });
  vi.stubGlobal('electronAPI', { invoke });
  const view = render(<Provider store={store}><ProjectRail /></Provider>);
  const tile = view.getByRole('button', { name: 'Switch to project poc-app' });
  await act(async () => {});
  expect(tile.textContent).toBe('PA');

  fireEvent.contextMenu(tile);
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Use 🚀 as project icon' })); });
  expect(invoke).toHaveBeenCalledWith('workspace:set-icon', { workspacePath: '/p/app', icon: '🚀' });
  expect(tile.textContent).toBe('🚀');

  // A typed lowercase word is stored as a Material Symbols icon, not text.
  fireEvent.contextMenu(tile);
  fireEvent.change(view.getByRole('textbox', { name: 'Custom project icon' }), { target: { value: 'database' } });
  await act(async () => { fireEvent.submit(view.getByRole('textbox', { name: 'Custom project icon' })); });
  expect(invoke).toHaveBeenCalledWith('workspace:set-icon', { workspacePath: '/p/app', icon: 'icon:database' });
  expect(tile.querySelector('.material-symbols-outlined')?.textContent).toBe('database');

  fireEvent.contextMenu(tile);
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Reset icon' })); });
  expect(tile.textContent).toBe('PA');

  // Colors override the tile's accent and stay put until reset.
  const item = tile.parentElement!;
  fireEvent.contextMenu(tile);
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Background #22c55e' })); });
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Icon & text #111827' })); });
  expect(item.style.getPropertyValue('--rail-item-bg')).toBe('#22c55e');
  expect(item.style.getPropertyValue('--rail-item-fg')).toBe('#111827');
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Reset background color' })); });
  expect(item.style.getPropertyValue('--rail-item-bg')).toBe('');
  expect(item.style.getPropertyValue('--rail-item-fg')).toBe('#111827');
});
