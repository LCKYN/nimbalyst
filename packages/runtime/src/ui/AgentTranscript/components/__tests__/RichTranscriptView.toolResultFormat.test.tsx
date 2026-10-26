import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptViewMessage } from '../../../../ai/server/transcript/TranscriptProjector';
import { RichTranscriptView } from '../RichTranscriptView';

vi.mock('virtua', async () => {
  const ReactModule = await import('react');
  return {
    VList: ReactModule.forwardRef(({ children }: { children: React.ReactNode }, ref) => {
      ReactModule.useImperativeHandle(ref, () => ({
        cache: undefined,
        scrollOffset: 0,
        scrollSize: 300,
        viewportSize: 100,
        findItemIndex: () => 0,
        scrollToIndex: vi.fn(),
      }));
      return <div data-testid="mock-vlist">{ReactModule.Children.toArray(children)}</div>;
    }),
  };
});

const message: TranscriptViewMessage = {
  id: 1,
  sequence: 1,
  createdAt: new Date(1_784_648_445_000),
  type: 'tool_call',
  subagentId: null,
  toolCall: {
    toolName: 'mcp__playwright__browser_navigate',
    toolDisplayName: 'Browser Navigate',
    status: 'completed',
    description: null,
    arguments: { url: 'http://localhost/login' },
    targetFilePath: null,
    mcpServer: 'playwright',
    mcpTool: 'browser_navigate',
    providerToolCallId: 'tc-1',
    progress: [],
    result: '### Page\n- Page Title: Acme',
  },
};

describe('RichTranscriptView tool result Rich/Raw toggle', () => {
  beforeEach(() => {
    vi.stubGlobal('CSS', { highlights: { delete: vi.fn(), set: vi.fn() } });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it('switches one card between markdown and raw text without closing the result', () => {
    const { container } = render(
      <RichTranscriptView sessionId="s" sessionStatus="idle" messages={[message]} provider="claude-code" persistScrollState={false} />,
    );
    fireEvent.click(container.querySelector('.rich-transcript-tool-button')!);

    expect(container.querySelector('.rich-transcript-tool-details-content h3')?.textContent).toBe('Page');

    fireEvent.click(screen.getByText('Raw'));
    expect(container.querySelector('.rich-transcript-tool-result-raw')?.textContent).toBe('### Page\n- Page Title: Acme');
    expect(container.querySelector('.rich-transcript-tool-details')?.hasAttribute('open')).toBe(true);

    fireEvent.click(screen.getByText('Rich'));
    expect(container.querySelector('.rich-transcript-tool-result-raw')).toBeNull();
  });
});
