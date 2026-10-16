/**
 * MermaidComponent - React component for rendering Mermaid diagrams
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey, NodeKey } from 'lexical';
import { $isMermaidNode } from './MermaidNode';
import { ErrorBoundary } from 'react-error-boundary';
import { MermaidDiagram } from './MermaidDiagram';

interface MermaidComponentProps {
  content: string;
  nodeKey: NodeKey;
  className?: string;
}

function MermaidComponent({ content: initialContent, nodeKey, className }: MermaidComponentProps) {
  const [editor] = useLexicalComposerContext();
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(initialContent);
  const [editedContent, setEditedContent] = useState(initialContent);
  const [renderKey, setRenderKey] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasInitializedRef = useRef(false);

  const handleRedraw = useCallback(() => {
    // Force re-render by incrementing the render key
    setRenderKey((k) => k + 1);
  }, []);

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, []);

  useEffect(() => {
    if (isEditing) {
      adjustTextareaHeight();
    }
  }, [editedContent, isEditing, adjustTextareaHeight]);

  // Save content to node when toggling edit mode off or on blur
  const saveToNode = useCallback((newContent: string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isMermaidNode(node)) {
        node.setContent(newContent);
      }
    });
  }, [editor, nodeKey]);

  const handleToggleEdit = () => {
    if (isEditing) {
      // Save when closing edit mode
      saveToNode(editedContent);
    }
    setIsEditing(!isEditing);
  };

  // Update local state and preview as user types (no node update yet)
  const handleContentChange = (newContent: string) => {
    setEditedContent(newContent);
    setContent(newContent);
  };

  // Only use initialContent on first mount
  useEffect(() => {
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      setContent(initialContent);
      setEditedContent(initialContent);
    }
  }, [initialContent]);

  return (
    <div className={`mermaid-block my-4 border border-[var(--nim-border)] rounded-lg bg-[var(--nim-bg)] overflow-hidden ${className || ''}`}>
      <div className="mermaid-header flex items-center justify-between px-4 py-2 bg-[var(--nim-bg-secondary)] border-b border-[var(--nim-border)]">
        <span className="mermaid-label font-medium text-[var(--nim-text)] text-sm flex items-center gap-2">Mermaid Diagram</span>
        <div className="mermaid-header-buttons flex gap-2">
          <button
            className="mermaid-redraw-button py-1 px-3 text-xs border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text-muted)] cursor-pointer transition-colors hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
            onClick={handleRedraw}
            title="Redraw diagram"
          >
            Redraw
          </button>
          <button
            className={`mermaid-edit-button py-1 px-3 text-xs border rounded cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isEditing
                ? 'bg-[var(--nim-primary)] text-white border-[var(--nim-primary)] hover:bg-[var(--nim-primary-hover)]'
                : 'border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]'
            }`}
            onClick={handleToggleEdit}
          >
            {isEditing ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      {isEditing && (
        <div className="mermaid-editor p-4 pb-0">
          <textarea
            ref={textareaRef}
            className="mermaid-textarea w-full min-h-[80px] p-3 border border-[var(--nim-border)] rounded font-mono text-sm resize-none overflow-hidden bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)] leading-relaxed focus:outline-none focus:border-[var(--nim-border-focus)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--nim-primary)_10%,transparent)]"
            value={editedContent}
            onChange={(e) => {
              handleContentChange(e.target.value);
              adjustTextareaHeight();
            }}
            onBlur={() => {
              // Save when textarea loses focus
              saveToNode(editedContent);
            }}
            placeholder="Enter Mermaid diagram code..."
            autoFocus
          />
        </div>
      )}

      <ErrorBoundary
        fallback={
          <div className="mermaid-error bg-[color-mix(in_srgb,var(--nim-error)_10%,var(--nim-bg))] border border-[color-mix(in_srgb,var(--nim-error)_30%,transparent)] rounded p-4 m-4 text-[var(--nim-error)]">
            Failed to render Mermaid diagram
          </div>
        }
      >
        <React.Suspense fallback={<div className="mermaid-loading text-[var(--nim-text-muted)] text-sm p-8 text-center">Loading...</div>}>
          <MermaidDiagram content={content} id={nodeKey} renderKey={renderKey} />
        </React.Suspense>
      </ErrorBoundary>
    </div>
  );
}

export default MermaidComponent;
