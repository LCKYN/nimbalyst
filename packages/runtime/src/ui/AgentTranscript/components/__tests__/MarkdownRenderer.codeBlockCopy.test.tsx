import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import * as rtl from '@testing-library/react';
import { MarkdownRenderer } from '../MarkdownRenderer';

const { render, screen, fireEvent, waitFor } = rtl;

const { copyToClipboard } = vi.hoisted(() => ({ copyToClipboard: vi.fn() }));
vi.mock('../../../../utils/clipboard', () => ({ copyToClipboard }));

describe('MarkdownRenderer code block copy button', () => {
  it('copies the fenced block text and briefly shows Copied', async () => {
    copyToClipboard.mockResolvedValueOnce(undefined);
    render(<MarkdownRenderer content={'```bash\nnpm install\n```'} />);

    // The button is icon-only, so its accessible name is the only label a
    // screen reader (or this test) can read.
    const button = screen.getByTestId('code-block-copy-button');
    expect(button.getAttribute('aria-label')).toBe('Copy code');

    fireEvent.click(button);

    expect(copyToClipboard).toHaveBeenCalledWith('npm install');
    await waitFor(() => expect(button.getAttribute('aria-label')).toBe('Copied'));
  });

  it('does not add a copy button to inline code spans, and keeps them inline', () => {
    const { container } = render(<MarkdownRenderer content="run `npm install` now" />);
    expect(screen.queryByTestId('code-block-copy-button')).toBeNull();

    // Inline spans share the fenced-block style object, so a change meant for
    // blocks can silently turn them into block elements - which breaks the
    // sentence onto separate lines and adds the copy button's reserved gutter.
    const inlineCode = container.querySelector('code');
    expect(inlineCode?.style.display).toBe('inline-block');
    expect(inlineCode?.style.padding).toBe('0.25rem 0.5rem');
  });
});
