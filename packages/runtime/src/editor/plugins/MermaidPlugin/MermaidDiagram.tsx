/**
 * MermaidDiagram - renders Mermaid source to SVG. Shared by the editor's
 * MermaidComponent and the agent transcript's markdown renderer.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { renderMermaid } from './mermaidRender';
import './mermaidGantt.css';

export function MermaidDiagram({ content, id, renderKey }: { content: string; id: string; renderKey: number }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { theme } = useTheme();
  const isDarkTheme = theme === 'dark' || theme === 'crystal-dark';

  useEffect(() => {
    let mounted = true;

    // Clear any pending render
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }

    // Debounce the render by 500ms
    renderTimeoutRef.current = setTimeout(async () => {
      try {
        // Use mermaid.render() for more control - it returns SVG directly
        // Use a unique ID with renderKey to avoid mermaid's internal caching issues
        const elementId = `mermaid_${id}_${renderKey}_${Date.now()}`;
        const { svg, bindFunctions } = await renderMermaid(elementId, content, isDarkTheme, containerRef.current);

        if (!mounted) return;

        // Insert the rendered SVG
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          // Bind any interactive functions (like click handlers) to the SVG
          if (bindFunctions) {
            bindFunctions(containerRef.current);
          }
          setError(null);
        }
      } catch (err: any) {
        if (mounted) {
          console.error('Mermaid render error:', err);
          // Extract error message - mermaid errors can have various structures
          let errorMessage = 'Failed to render diagram';
          if (typeof err === 'string') {
            errorMessage = err;
          } else if (err?.message) {
            errorMessage = err.message;
          } else if (err?.str) {
            // Mermaid parser errors often have a 'str' property
            errorMessage = err.str;
          } else if (err?.hash?.text) {
            // Some mermaid errors have hash.text
            errorMessage = `Parse error near: ${err.hash.text}`;
          } else if (typeof err === 'object') {
            // Last resort: try to stringify the object for debugging
            try {
              const jsonStr = JSON.stringify(err, null, 2);
              if (jsonStr !== '{}') {
                errorMessage = jsonStr;
              }
            } catch {
              // If JSON.stringify fails, keep default message
            }
          }
          setError(errorMessage);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }, 500);

    return () => {
      mounted = false;
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [content, id, isDarkTheme, renderKey]);

  return (
    <div className="mermaid-diagram p-6 min-h-[200px] flex flex-col items-center justify-center">
      {loading && !error && <div className="mermaid-loading text-[var(--nim-text-muted)] text-sm p-8 text-center">Loading diagram...</div>}
      <div ref={containerRef} className="mermaid-render-container w-full overflow-x-auto" />
      {error && (
        <div className="mermaid-error bg-[color-mix(in_srgb,var(--nim-error)_10%,var(--nim-bg))] border border-[color-mix(in_srgb,var(--nim-error)_30%,transparent)] rounded p-4 m-4 text-[var(--nim-error)]">
          <strong className="block mb-2">Diagram Error:</strong>
          <pre className="m-0 font-mono text-xs whitespace-pre-wrap break-words">{error}</pre>
        </div>
      )}
    </div>
  );
}
