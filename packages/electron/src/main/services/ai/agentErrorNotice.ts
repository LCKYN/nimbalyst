export type AgentErrorKind = 'usage_limit' | 'network' | 'error';

export interface AgentErrorNotice {
  kind: AgentErrorKind;
  title: string;
  body: string;
  /** Epoch ms when a usage limit resets, when it could be determined. */
  resetsAt?: number;
}

const TITLES: Record<AgentErrorKind, string> = {
  usage_limit: 'Usage limit reached',
  network: 'Connection lost',
  error: 'Agent stopped with an error',
};

/** Turn a provider error into the title/body used by OS and mobile notices. */
export function classifyAgentErrorNotice(
  message: string,
  streamedText: string,
  now = Date.now(),
): AgentErrorNotice {
  const kind: AgentErrorKind = /session limit|usage limit|hit your .*limit|rate limit/i.test(message)
    ? 'usage_limit'
    : /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|can't reach the api|network/i.test(message)
    ? 'network'
    : 'error';
  const trimmed = message.trim();
  const body = trimmed.length > 100 ? `${trimmed.slice(0, 99)}…` : trimmed;
  const resetsAt = kind === 'usage_limit' ? parseResetsAt(message, streamedText, now) : undefined;
  return { kind, title: TITLES[kind], body, ...(resetsAt ? { resetsAt } : {}) };
}

/** Notification body: the error, plus the reset time when it is known. */
export function agentErrorNoticeText(notice: AgentErrorNotice): string {
  if (!notice.resetsAt) return notice.body;
  const time = new Date(notice.resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${notice.body} · Resets ${time}`;
}

function parseResetsAt(message: string, streamedText: string, now: number): number | undefined {
  // ClaudeCodeProvider streams `resetsAtUnix=<seconds>` for rate_limit_event; the latest wins.
  const markers = [...streamedText.matchAll(/resetsAtUnix=(\d+)/g)];
  if (markers.length > 0) return Number(markers[markers.length - 1][1]) * 1000;

  const match = message.match(/resets (\d{1,2})(?::(\d{2}))?\s*(am|pm)(?: \(([^)]+)\))?/i);
  if (!match) return undefined;
  const hour = (Number(match[1]) % 12) + (match[3].toLowerCase() === 'pm' ? 12 : 0);
  const minute = Number(match[2] ?? 0);
  let zone: string | undefined = match[4];
  try {
    if (zone) new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zone = undefined; // Unknown zone: fall back to local time.
  }
  const today = zoneParts(now, zone);
  for (let day = 0; day < 2; day++) {
    const wall = Date.UTC(today.year, today.month - 1, today.day + day, hour, minute);
    const at = wall - zoneOffset(wall, zone);
    if (at > now) return at;
  }
  return undefined;
}

function zoneParts(at: number, timeZone: string | undefined) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `timeZone` from UTC at roughly `at`, in ms. */
function zoneOffset(at: number, timeZone: string | undefined): number {
  const p = zoneParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}
