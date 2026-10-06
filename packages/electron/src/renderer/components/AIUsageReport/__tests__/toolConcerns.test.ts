// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { findToolConcerns, mergeToolRows, type ToolUsageReportRow } from '../ToolUsage';

const tool = (toolName: string, count: number, errorCount: number, resultTokens = 0): ToolUsageReportRow => ({
  toolName,
  mcpServer: null,
  count,
  errorCount,
  callTokens: 0,
  resultTokens,
});

describe('findToolConcerns', () => {
  it('flags frequent failures, heavy calls and dominant tools, worst first', () => {
    const concerns = findToolConcerns(
      [
        tool('Bash', 10_000, 300, 1_000_000), // 3% failing, 100 tokens/call, 25% share
        tool('ExitPlanMode', 65, 44), // 68% failing
        tool('screenshot', 100, 0, 1_500_000), // 15K per call, 37.5% share
        tool('Flaky', 4, 3), // too few failures to mean anything
        tool('Edit', 2_000, 19, 500_000), // fine
      ],
      4_000_000,
    );

    expect(concerns.map((c) => c.tool.toolName)).toEqual(['ExitPlanMode', 'screenshot', 'Bash']);
    expect(concerns[0].reasons.map((r) => r.kind)).toEqual(['failing']);
    expect(concerns[1].reasons.map((r) => r.kind)).toEqual(['heavy', 'heavy']);
  });

  it('flags nothing without token data or failures', () => {
    expect(findToolConcerns([tool('Read', 500, 2)], 0)).toEqual([]);
  });
});

describe('mergeToolRows', () => {
  it('keeps a tool that is heavy but outside the top tools by count', () => {
    const merged = mergeToolRows({ topTools: [tool('Bash', 10, 0)], heaviestTools: [tool('Bash', 10, 0), tool('Rare', 1, 0, 9_000)] });
    expect(merged.map((t) => t.toolName)).toEqual(['Bash', 'Rare']);
  });
});
