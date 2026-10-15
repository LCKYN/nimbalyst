import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VisualDisplayWidget } from '../VisualDisplayWidget';

describe('VisualDisplayWidget', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let boundingClientRectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    boundingClientRectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 600,
      height: 300,
      top: 0,
      right: 600,
      bottom: 300,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    boundingClientRectSpy.mockRestore();
  });

  it('does not warn about invalid chart dimensions before the container is measured', () => {
    render(
      <VisualDisplayWidget
        message={{
          toolCall: {
            toolName: 'display_to_user',
            arguments: {
              items: [{
                description: 'Example chart',
                chart: {
                  chartType: 'bar',
                  data: [{ category: 'A', value: 1 }],
                  xAxisKey: 'category',
                  yAxisKey: 'value',
                },
              }],
            },
          },
        } as any}
        isExpanded={true}
        onToggle={() => {}}
        sessionId="session-1"
      />
    );

    const invalidSizeWarning = consoleWarnSpy.mock.calls.find((call: unknown[]) => {
      const message: unknown = call[0];
      return typeof message === 'string'
        && message.includes('The width(')
        && message.includes('of chart should be greater than 0');
    });
    expect(invalidSizeWarning).toBeUndefined();
  });

  it('loads the lightbox image through readFile, not nim-asset (outside allowed folders it 403s)', async () => {
    const readFile = vi.fn().mockResolvedValue({ success: true, content: 'iVBORw0KGgo=' });
    render(
      <VisualDisplayWidget
        message={{
          toolCall: {
            toolName: 'display_to_user',
            arguments: { items: [{ description: 'Shot', image: { path: '/tmp/qa/shot.png' } }] },
          },
        } as any}
        isExpanded={true}
        onToggle={() => {}}
        sessionId="session-1"
        readFile={readFile}
      />
    );

    fireEvent.click(await screen.findByAltText('Shot'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByAltText('Shot').getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
    });
  });

  it('renders SVG text from readFile as an svg data URL', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const readFile = vi.fn().mockResolvedValue({ success: true, content: svg });
    render(
      <VisualDisplayWidget
        message={{
          toolCall: {
            toolName: 'display_to_user',
            arguments: { items: [{ description: 'Vector', image: { path: '/tmp/qa/icon.svg' } }] },
          },
        } as any}
        isExpanded={true}
        onToggle={() => {}}
        sessionId="session-1"
        readFile={readFile}
      />
    );

    expect((await screen.findByAltText('Vector')).getAttribute('src'))
      .toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  });
});
