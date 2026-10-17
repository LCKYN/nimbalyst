import React, { useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { projectAppearanceAtom, saveProjectAppearanceAtom } from '../../../store/atoms/projectAppearance';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { PROJECT_COLOR_CHOICES, PROJECT_EMOJI_CHOICES, PROJECT_SYMBOL_CHOICES, generateWorkspaceAccentColor, initialsLength, projectIconForeground, projectInitials, projectSymbol, type ProjectAppearanceUpdate } from '../../../../shared/projectAppearance';
import { ProjectIcon } from '../../ProjectIcon';
import { getFileName } from '../../../utils/pathUtils';
import './ProjectAppearancePanel.css';

async function importThumbnail(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 128 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the image.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally { bitmap.close(); }
}

export function ProjectAppearancePanel({ workspacePath }: { workspacePath: string }) {
  const { snapshot, error: loadError } = useAtomValue(projectAppearanceAtom(workspacePath));
  const save = useSetAtom(saveProjectAppearanceAtom);
  const [patch, setPatch] = useState<ProjectAppearanceUpdate>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const name = getFileName(workspacePath) || 'Project';
  const saved = snapshot?.appearance ?? {};
  const appearance = {
    initials: patch.initials === undefined ? saved.initials : patch.initials || undefined,
    color: patch.color === undefined ? saved.color : patch.color || undefined,
    textColor: patch.textColor === undefined ? saved.textColor : patch.textColor || undefined,
    imageUrl: patch.image === undefined ? saved.imageUrl : patch.image || undefined,
    detectedImageUrl: saved.detectedImageUrl,
  };
  const foreground = appearance.textColor || projectIconForeground(appearance.color);
  const change = (update: ProjectAppearanceUpdate) => {
    setPatch(current => ({ ...current, ...update })); setStatus(''); setError('');
  };
  const persist = async (update: ProjectAppearanceUpdate) => {
    setBusy(true); setError(''); setStatus('');
    try { await save(workspacePath, update); setPatch({}); setStatus('Saved'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const invalidInitials = initialsLength(appearance.initials?.trim() || '') > 3 && !projectSymbol(appearance.initials?.trim());
  return (
    <section className="project-appearance-panel" data-testid="project-appearance-panel" data-project-path={workspacePath}>
      <h2>Appearance</h2>
      <p>Choose how {name} appears in the project rail. These settings apply only on this computer.</p>
      <div className="project-appearance-preview-row">
        <div className="project-appearance-preview" data-testid="project-appearance-preview"
          style={{ background: appearance.color || generateWorkspaceAccentColor(workspacePath), color: foreground }}>
          <ProjectIcon name={name} appearance={appearance} />
        </div>
        <div><strong>{name}</strong><div className="project-appearance-path" title={workspacePath}>{workspacePath}</div></div>
      </div>
      <fieldset disabled={busy || !snapshot}>
        <label htmlFor="project-initials">Initials or emoji</label>
        <input id="project-initials" data-testid="project-appearance-initials" type="text" maxLength={64}
          value={appearance.initials || ''} placeholder={projectInitials(name)} aria-invalid={invalidInitials}
          aria-describedby="project-initials-help" onChange={e => change({ initials: e.target.value || null })} />
        <p id="project-initials-help">Up to three characters or an emoji. Leave blank to use {projectInitials(name)}.</p>
        <div className="project-appearance-emoji-grid" data-testid="project-appearance-emoji-grid">
          {PROJECT_EMOJI_CHOICES.map(emoji => (
            <button key={emoji} type="button" aria-label={`Use ${emoji}`} aria-pressed={appearance.initials === emoji}
              onClick={() => change({ initials: emoji })}>{emoji}</button>
          ))}
          {PROJECT_SYMBOL_CHOICES.map(symbol => (
            <button key={symbol} type="button" aria-label={`Use ${symbol}`} aria-pressed={appearance.initials === `icon:${symbol}`}
              onClick={() => change({ initials: `icon:${symbol}` })}><MaterialSymbol icon={symbol} size={18} /></button>
          ))}
        </div>
        <label htmlFor="project-color">Background color</label>
        <div className="project-appearance-controls">
          <input id="project-color" data-testid="project-appearance-color" type="color" value={appearance.color || generateWorkspaceAccentColor(workspacePath, 'hex')}
            onChange={e => change({ color: e.target.value })} />
          <span>{appearance.color || 'Automatic'}</span>
          <button type="button" disabled={!appearance.color} onClick={() => change({ color: null })}>Use automatic color</button>
        </div>
        <div className="project-appearance-color-grid" data-testid="project-appearance-color-grid">
          {PROJECT_COLOR_CHOICES.map(color => (
            <button key={color} type="button" aria-label={`Use color ${color}`} aria-pressed={appearance.color === color}
              style={{ background: color }} onClick={() => change({ color })} />
          ))}
        </div>
        <label htmlFor="project-text-color">Text color</label>
        <div className="project-appearance-controls">
          <input id="project-text-color" data-testid="project-appearance-text-color" type="color" value={foreground}
            onChange={e => change({ textColor: e.target.value })} />
          <span>{appearance.textColor || 'Automatic'}</span>
          <button type="button" disabled={!appearance.textColor} onClick={() => change({ textColor: null })}>Use automatic text color</button>
        </div>
        <label htmlFor="project-image">Image</label>
        <input id="project-image" ref={fileInput} data-testid="project-appearance-file" type="file" accept="image/png,image/jpeg,image/webp"
          hidden onChange={async e => {
            const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
            setBusy(true); setError('');
            try { change({ image: await importThumbnail(file) }); }
            catch (err) { setError(err instanceof Error ? err.message : 'Could not read this image.'); }
            finally { setBusy(false); }
          }} />
        <div className="project-appearance-controls">
          <button type="button" onClick={() => fileInput.current?.click()}>Choose image…</button>
          {appearance.imageUrl && <button type="button" onClick={() => change({ image: null })}>Remove image</button>}
        </div>
        <p>PNG, JPEG, or WebP, up to 5 MB. Images replace the initials. Without one, a favicon or logo found in the project is used when no initials are set.</p>
        <div className="project-appearance-actions">
          <button type="button" className="project-appearance-save" data-testid="project-appearance-save"
            disabled={invalidInitials || !Object.keys(patch).length} onClick={() => persist(patch)}>Save changes</button>
          <button type="button" onClick={() => persist({ initials: null, color: null, textColor: null, image: null })}>Reset to default</button>
          <span role="status">{busy ? 'Saving…' : status}</span>
        </div>
      </fieldset>
      {(error || loadError || invalidInitials) && <p className="project-appearance-error" role="alert">{error || loadError || 'Use up to three characters for the initials.'}</p>}
    </section>
  );
}
