// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classifyAgentErrorNotice } from '../agentErrorNotice';

const LIMIT = "You've hit your session limit · resets 8pm (Asia/Bangkok)";
// 2026-10-05 19:14 in Bangkok (UTC+7).
const BEFORE_RESET = Date.UTC(2026, 9, 5, 12, 14);

describe('classifyAgentErrorNotice', () => {
  it('classifies the session limit and resolves the reset in the named zone', () => {
    const notice = classifyAgentErrorNotice(LIMIT, '', BEFORE_RESET);
    expect(notice).toMatchObject({ kind: 'usage_limit', title: 'Usage limit reached', body: LIMIT });
    expect(notice.resetsAt).toBe(Date.UTC(2026, 9, 5, 13, 0)); // 20:00 Bangkok
  });

  it('prefers the streamed resetsAtUnix marker over the text', () => {
    const streamed = '<!-- [RATE_LIMIT] limitType=5-hour session resetsAtUnix=1791300000 -->';
    expect(classifyAgentErrorNotice(LIMIT, streamed, BEFORE_RESET).resetsAt).toBe(1791300000 * 1000);
  });

  it('rolls a reset time already past today over to tomorrow', () => {
    const afterReset = Date.UTC(2026, 9, 5, 14, 0); // 21:00 Bangkok
    expect(classifyAgentErrorNotice(LIMIT, '', afterReset).resetsAt).toBe(Date.UTC(2026, 9, 6, 13, 0));
  });

  it('classifies ENOTFOUND as a connection loss', () => {
    const notice = classifyAgentErrorNotice(
      'API Error: Unable to connect to API (getaddrinfo ENOTFOUND api.anthropic.com)',
      '',
    );
    expect(notice).toMatchObject({ kind: 'network', title: 'Connection lost' });
    expect(notice.resetsAt).toBeUndefined();
  });
});
