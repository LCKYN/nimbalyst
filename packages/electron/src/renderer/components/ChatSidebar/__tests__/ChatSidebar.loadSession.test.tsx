// @vitest-environment jsdom
/**
 * A host-driven loadSession (the PR pane pointing the chat at the selected PR's
 * session) must survive mount-time auto-init, which resolves ~100ms later and
 * would otherwise snap back to the most recent chat session.
 */
import React, { createRef } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatSidebar, type ChatSidebarRef } from '../ChatSidebar';
import { GithubPanelShell } from '../../PullRequestMode/GithubPanelShell';

vi.mock('../../PullRequestMode/GhOnboardingBanner', () => ({ GhOnboardingBanner: () => null }));
vi.mock('../../../store/atoms/pullRequests', async () => {
  const { atom } = await import('jotai');
  return {
    prModeLayoutAtom: atom({ chatCollapsed: false, chatWidth: 350, sidebarWidth: 250 }),
    setPrModeLayoutAtom: atom(null, () => {}),
  };
});

vi.mock('../../../store', async () => {
  const { atom } = await import('jotai');
  return {
    sessionListChatAtom: atom([]),
    refreshSessionListAtom: atom(null, () => {}),
    initSessionList: vi.fn(),
  };
});

vi.mock('../../../store/atoms/appSettings', async () => {
  const { atom } = await import('jotai');
  return {
    defaultAgentModelAtom: atom('claude-code:sonnet'),
  };
});

const transcriptRenders: Array<[string, string]> = [];
vi.mock('../../UnifiedAI/SessionTranscript', () => ({
  SessionTranscript: ({ sessionId, workspacePath }: { sessionId: string; workspacePath: string }) => {
    transcriptRenders.push([sessionId, workspacePath]);
    return <div data-testid="session-transcript" data-session-id={sessionId} />;
  },
}));

vi.mock('../../AIChat/SessionDropdown', () => ({
  SessionDropdown: () => null,
}));

describe('ChatSidebar loadSession vs auto-init', () => {
  beforeEach(() => {
    (window as any).electronAPI = {
      invoke: vi.fn().mockImplementation(async (channel: string) => {
        if (channel === 'sessions:list') {
          return {
            success: true,
            sessions: [{ id: 'most-recent-chat', worktreeId: null, childCount: 0 }],
          };
        }
        return { success: true };
      }),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps a host-loaded session instead of the auto-selected most recent one', async () => {
    const ref = createRef<ChatSidebarRef>();
    const view = render(<ChatSidebar ref={ref} workspacePath="/workspace" />);

    // Load before auto-init's 100ms wait resolves — the PR pane's selection.
    act(() => {
      ref.current?.loadSession('pr-linked-session');
    });

    await waitFor(() => {
      view.getByTestId('chat-sidebar-panel');
    });
    expect(view.getByTestId('session-transcript').getAttribute('data-session-id')).toBe(
      'pr-linked-session',
    );
  });

  it('still auto-selects the most recent session when the host loads nothing', async () => {
    const view = render(<ChatSidebar workspacePath="/workspace" />);

    await waitFor(() => {
      expect(view.getByTestId('session-transcript').getAttribute('data-session-id')).toBe(
        'most-recent-chat',
      );
    });
  });

  it('re-selects for the new project on a switch, and a slow superseded project cannot win', async () => {
    let resolveB!: (value: unknown) => void;
    (window.electronAPI.invoke as any).mockImplementation(async (channel: string, workspace: string) => {
      if (channel !== 'sessions:list') return { success: true };
      const sessions = [{ id: `${workspace}-recent`, worktreeId: null, childCount: 0 }];
      if (workspace === '/b2') return new Promise(resolve => { resolveB = () => resolve({ success: true, sessions }); });
      return { success: true, sessions };
    });
    const ref = createRef<ChatSidebarRef>();
    const shownSession = () => view.queryByTestId('session-transcript')?.getAttribute('data-session-id');
    const view = render(<ChatSidebar ref={ref} workspacePath="/a" />);
    await waitFor(() => expect(shownSession()).toBe('/a-recent'));
    act(() => { ref.current?.loadSession('a-session'); });

    // An earlier explicit pick in /a must not pin the chat after switching to /b.
    transcriptRenders.length = 0;
    view.rerender(<ChatSidebar ref={ref} workspacePath="/b" />);
    await waitFor(() => expect(shownSession()).toBe('/b-recent'));
    // Not even for one render may /a's session be loaded under /b.
    expect(transcriptRenders).not.toContainEqual(['a-session', '/b']);

    // Fast /b2 -> /c: /b2's list is still pending when /c takes over.
    view.rerender(<ChatSidebar ref={ref} workspacePath="/b2" />);
    await waitFor(() => expect(resolveB).toBeTypeOf('function'));
    view.rerender(<ChatSidebar ref={ref} workspacePath="/c" />);
    await waitFor(() => expect(shownSession()).toBe('/c-recent'));
    await act(async () => { resolveB(undefined); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(shownSession()).toBe('/c-recent');
  });

  it('keeps unmatched GitHub selections empty and follows late matches across PRs and issues', async () => {
    const panel = (selectionKey: string | null, ids: string[] = []) => (
      <GithubPanelShell workspacePath="/workspace" isActive selectionKey={selectionKey}
        selectionSessions={ids.map(id => ({ id }))} />
    );
    const view = render(panel('pr-1'));
    // Let the normal sidebar initialization finish: this host must opt out.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
    expect(view.queryByTestId('session-transcript')).toBeNull();
    expect(view.queryByText('Failed to load chat session')).toBeNull();
    expect(window.electronAPI.invoke).not.toHaveBeenCalledWith('sessions:list', expect.anything(), expect.anything());

    view.rerender(panel('pr-1', ['pr-session']));
    expect(view.getByTestId('session-transcript').getAttribute('data-session-id')).toBe('pr-session');
    view.rerender(panel('pr-2'));
    expect(view.queryByTestId('session-transcript')).toBeNull();
    view.rerender(panel('issue-1', ['issue-session']));
    expect(view.getByTestId('session-transcript').getAttribute('data-session-id')).toBe('issue-session');
    view.rerender(panel('issue-2'));
    expect(view.queryByTestId('session-transcript')).toBeNull();
    view.rerender(panel('pr-1', ['pr-session']));
    expect(view.getByTestId('session-transcript').getAttribute('data-session-id')).toBe('pr-session');
    view.rerender(panel(null));
    expect(view.queryByTestId('session-transcript')).toBeNull();
  });
});
