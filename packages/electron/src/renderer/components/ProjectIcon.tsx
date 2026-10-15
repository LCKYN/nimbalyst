import React, { useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { projectInitials, projectSymbol, type ProjectAppearance } from '../../shared/projectAppearance';

/** Shared by the rail and settings preview, including the missing-image fallback. */
export function ProjectIcon({ name, appearance }: { name: string; appearance: ProjectAppearance }) {
  const [failedImage, setFailedImage] = useState<string>();
  // Chosen image, then chosen initials/emoji, then a logo found in the project, then automatic initials.
  const image = appearance.imageUrl || (!appearance.initials ? appearance.detectedImageUrl : undefined);
  const symbol = projectSymbol(appearance.initials);
  return image && failedImage !== image
    ? <img className="project-icon-image" src={image} alt="" draggable={false}
        onError={() => setFailedImage(image)} />
    : symbol ? <MaterialSymbol icon={symbol} size={22} />
    : <span className="project-icon-initials">{appearance.initials || projectInitials(name)}</span>;
}
