import { readFile, stat } from 'fs/promises';
import { extname, join } from 'path';

/**
 * Files checked, in order, for a project's rail icon. `.nimbalyst/icon.*`
 * lets a user pick one explicitly; the rest are common web-app favicon spots.
 */
const ICON_CANDIDATES = [
  '.nimbalyst/icon.png',
  '.nimbalyst/icon.svg',
  'favicon.svg',
  'favicon.png',
  'favicon.ico',
  'public/favicon.svg',
  'public/favicon.png',
  'public/favicon.ico',
  'app/icon.svg',
  'app/icon.png',
  'app/favicon.ico',
  'src/app/icon.svg',
  'src/app/icon.png',
  'src/app/favicon.ico',
  'static/favicon.png',
  'static/favicon.ico',
  'logo.svg',
  'logo.png',
];

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const MAX_ICON_BYTES = 512 * 1024;

/** Returns the first project icon found as a data URL, or null. */
export async function findProjectIcon(workspacePath: string): Promise<string | null> {
  for (const relative of ICON_CANDIDATES) {
    const fullPath = join(workspacePath, relative);
    try {
      const info = await stat(fullPath);
      if (!info.isFile() || info.size === 0 || info.size > MAX_ICON_BYTES) continue;
      const data = await readFile(fullPath);
      return `data:${MIME[extname(relative)]};base64,${data.toString('base64')}`;
    } catch {
      // Missing candidate; try the next one.
    }
  }
  return null;
}
