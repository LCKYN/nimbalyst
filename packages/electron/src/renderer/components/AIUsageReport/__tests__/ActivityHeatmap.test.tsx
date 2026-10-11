// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { ActivityHeatmap } from '../ActivityHeatmap';

/**
 * The cells used to carry the hover text in a bare `data-tooltip` attribute.
 * Nothing in the app renders that attribute -- no CSS rule, no component -- so
 * the text was composed on every one of the 168 cells and shown on none of
 * them. A grid of unlabelled squares looks finished, which is why this went
 * unnoticed; that is what these tests are here to catch.
 */
describe('ActivityHeatmap hover readout', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Thursday (dayOfWeek 4) at 15:00, 15 messages.
    invoke.mockResolvedValue([{ dayOfWeek: 4, hourOfDay: 15, activityCount: 15 }]);
    (window as unknown as { electronAPI: unknown }).electronAPI = { invoke };
  });

  it('shows the day, hour and count for the hovered cell', async () => {
    render(<ActivityHeatmap />);

    const cell = await screen.findByLabelText('Thu 15:00 - 15 messages sent');
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(cell);

    await waitFor(() => {
      expect(screen.getByRole('tooltip').textContent).toBe('Thu 15:00 - 15 messages sent');
    });

    fireEvent.mouseLeave(cell);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('reads out an hour with no activity as zero rather than leaving it blank', async () => {
    render(<ActivityHeatmap />);

    // A quiet cell renders no count digit, so the hover readout is the only
    // place its value is stated.
    const quiet = await screen.findByLabelText('Mon 03:00 - 0 messages sent');
    fireEvent.mouseEnter(quiet);

    await waitFor(() => {
      expect(screen.getByRole('tooltip').textContent).toBe('Mon 03:00 - 0 messages sent');
    });
  });

  it('adds the hour\'s token total once the slower token scan lands', async () => {
    invoke.mockImplementation((channel: string) =>
      channel === 'usage-analytics:get-token-heatmap'
        ? Promise.resolve([{ dayOfWeek: 4, hourOfDay: 15, totalTokens: 82_430 }])
        : Promise.resolve([{ dayOfWeek: 4, hourOfDay: 15, activityCount: 15 }]),
    );

    render(<ActivityHeatmap />);

    const cell = await screen.findByLabelText('Thu 15:00 - 15 messages sent · 82,430 tokens');
    fireEvent.mouseEnter(cell);

    await waitFor(() => {
      expect(screen.getByRole('tooltip').textContent).toBe(
        'Thu 15:00 - 15 messages sent · 82,430 tokens',
      );
    });
  });

  // "0 tokens" would claim the hour cost nothing; a missing clause correctly
  // says nothing at all while the scan is still out.
  it('omits the token clause rather than showing zero when the scan fails', async () => {
    invoke.mockImplementation((channel: string) =>
      channel === 'usage-analytics:get-token-heatmap'
        ? Promise.reject(new Error('scan failed'))
        : Promise.resolve([{ dayOfWeek: 4, hourOfDay: 15, activityCount: 15 }]),
    );

    render(<ActivityHeatmap />);

    const cell = await screen.findByLabelText('Thu 15:00 - 15 messages sent');
    fireEvent.mouseEnter(cell);

    await waitFor(() => {
      expect(screen.getByRole('tooltip').textContent).toBe('Thu 15:00 - 15 messages sent');
    });
  });

  it('phrases the readout for the metric being shown', async () => {
    render(<ActivityHeatmap />);
    await screen.findByLabelText('Thu 15:00 - 15 messages sent');

    fireEvent.click(screen.getByText('Edited'));

    const cell = await screen.findByLabelText('Thu 15:00 - 15 edits saved');
    fireEvent.mouseEnter(cell);

    await waitFor(() => {
      expect(screen.getByRole('tooltip').textContent).toBe('Thu 15:00 - 15 edits saved');
    });
  });
});
