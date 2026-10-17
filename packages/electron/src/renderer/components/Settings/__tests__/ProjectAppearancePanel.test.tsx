import React from 'react';
import { Provider, createStore } from 'jotai';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectAppearancePanel } from '../panels/ProjectAppearancePanel';
import { projectAppearanceAtom } from '../../../store/atoms/projectAppearance';
import { PROJECT_COLOR_CHOICES, generateWorkspaceAccentColor } from '../../../../shared/projectAppearance';
const workspacePath = '/projects/FileRocket';
beforeEach(() => { (window as any).electronAPI = { invoke: vi.fn(), on: vi.fn() }; });
afterEach(() => { cleanup(); projectAppearanceAtom.remove(workspacePath); });
function mount(appearance = {}) {
  const store = createStore();
  store.set(projectAppearanceAtom(workspacePath), { snapshot: { revision: 0, appearance } });
  return render(<Provider store={store}><ProjectAppearancePanel workspacePath={workspacePath} /></Provider>);
}
it('previews overrides, saves explicitly to the target project, and resets all overrides', async () => {
  const invoke = vi.fn().mockResolvedValue({ revision: 1, appearance: { initials: 'FR' } });
  window.electronAPI.invoke = invoke;
  const view = mount();
  expect(view.getByTestId('project-appearance-preview').textContent).toBe('FI');
  fireEvent.change(view.getByLabelText('Initials or emoji'), { target: { value: 'FR' } });
  expect(view.getByTestId('project-appearance-preview').textContent).toBe('FR');
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(view.getByText('Save changes'));
  await waitFor(() => expect(view.getByRole('status').textContent).toBe('Saved'));
  expect(invoke).toHaveBeenCalledWith('project-appearance:update', workspacePath, { initials: 'FR' });
  invoke.mockResolvedValue({ revision: 2, appearance: {} });
  fireEvent.click(view.getByText('Reset to default'));
  await waitFor(() => expect(view.getByTestId('project-appearance-preview').textContent).toBe('FI'));
  expect(invoke).toHaveBeenLastCalledWith('project-appearance:update', workspacePath, { initials: null, color: null, textColor: null, image: null });
});
it('keeps edits and explains a failed save', async () => {
  window.electronAPI.invoke = vi.fn().mockRejectedValue(new Error('Disk full'));
  const view = mount();
  fireEvent.change(view.getByLabelText('Initials or emoji'), { target: { value: 'FR' } });
  fireEvent.click(view.getByText('Save changes'));
  await waitFor(() => expect(view.getByRole('alert').textContent).toContain('Disk full'));
  expect(view.getByTestId('project-appearance-preview').textContent).toBe('FR');
  expect((view.getByText('Save changes') as HTMLButtonElement).disabled).toBe(false);
});
it('falls back to initials when a stored thumbnail cannot load', () => {
  const view = mount({ initials: 'FR', imageUrl: 'nim-asset://local/missing' });
  fireEvent.error(view.getByTestId('project-appearance-preview').querySelector('img')!);
  expect(view.getByTestId('project-appearance-preview').textContent).toBe('FR');
});
it('picks an emoji over a detected logo and saves it with a text color', async () => {
  const invoke = vi.fn().mockResolvedValue({ revision: 1, appearance: {} });
  window.electronAPI.invoke = invoke;
  const view = mount({ detectedImageUrl: 'data:image/png;base64,AA==' });
  const preview = view.getByTestId('project-appearance-preview');
  expect(preview.querySelector('img')).not.toBeNull();
  fireEvent.click(view.getByLabelText('Use 🚀'));
  fireEvent.change(view.getByLabelText('Text color'), { target: { value: '#ff0000' } });
  expect(preview.querySelector('img')).toBeNull();
  expect(preview.textContent).toBe('🚀');
  expect(preview.style.color).toBe('rgb(255, 0, 0)');
  fireEvent.click(view.getByText('Save changes'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('project-appearance:update', workspacePath, { initials: '🚀', textColor: '#ff0000' }));
});
it('saves a symbol icon even though its stored name is longer than three characters', async () => {
  const invoke = vi.fn().mockResolvedValue({ revision: 1, appearance: {} });
  window.electronAPI.invoke = invoke;
  const view = mount();
  fireEvent.click(view.getByLabelText('Use school'));
  expect(view.queryByRole('alert')).toBeNull();
  fireEvent.click(view.getByText('Save changes'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('project-appearance:update', workspacePath, { initials: 'icon:school' }));
});
it('offers 12 hues in 3 shades and saves a picked preset as the background', async () => {
  // Middle row is the automatic palette: '/p3' hashes to hue 90, a preset hue.
  expect(PROJECT_COLOR_CHOICES).toHaveLength(36);
  expect(PROJECT_COLOR_CHOICES.slice(12, 24)).toContain(generateWorkspaceAccentColor('/p3', 'hex'));
  const invoke = vi.fn().mockResolvedValue({ revision: 1, appearance: {} });
  window.electronAPI.invoke = invoke;
  const view = mount();
  const dark = PROJECT_COLOR_CHOICES[24];
  fireEvent.click(view.getByLabelText(`Use color ${dark}`));
  expect(view.getByLabelText(`Use color ${dark}`).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(view.getByText('Save changes'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('project-appearance:update', workspacePath, { color: dark }));
});
