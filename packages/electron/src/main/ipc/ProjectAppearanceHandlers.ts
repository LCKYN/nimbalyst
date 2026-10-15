import { BrowserWindow } from 'electron';
import { safeHandle } from '../utils/ipcRegistry';
import { getProjectAppearance, updateProjectAppearance } from '../services/projectAppearance';
import { findProjectIcon } from '../utils/projectIcon';
import type { ProjectAppearanceSnapshot } from '../../shared/projectAppearance';

async function withDetectedImage(workspacePath: string, snapshot: ProjectAppearanceSnapshot): Promise<ProjectAppearanceSnapshot> {
  if (snapshot.appearance.imageUrl) return snapshot;
  const detectedImageUrl = await findProjectIcon(workspacePath);
  return detectedImageUrl ? { ...snapshot, appearance: { ...snapshot.appearance, detectedImageUrl } } : snapshot;
}

export function registerProjectAppearanceHandlers(): void {
  safeHandle('project-appearance:get', (_event, workspacePath: string) =>
    withDetectedImage(workspacePath, getProjectAppearance(workspacePath)));
  safeHandle('project-appearance:update', async (_event, workspacePath: string, patch: unknown) => {
    const snapshot = await withDetectedImage(workspacePath, updateProjectAppearance(workspacePath, patch));
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('project-appearance:changed', { workspacePath, ...snapshot });
    }
    return snapshot;
  });
}
