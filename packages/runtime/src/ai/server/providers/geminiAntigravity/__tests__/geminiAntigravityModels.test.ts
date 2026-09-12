// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { SEED_GEMINI_MODELS, selectGeminiModels } from '../geminiAntigravityModels';
import type { AntigravityModelInfo } from '../AntigravityServerManager';

function model(overrides: Partial<AntigravityModelInfo>): AntigravityModelInfo {
  return {
    key: 'model-key',
    enum: 'MODEL_PLACEHOLDER',
    displayName: 'Gemini 3.8 Flash',
    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
    ...overrides,
  };
}

describe('selectGeminiModels', () => {
  it('drops superseded Flash tiers even when entitled, keeping only 3.8 Flash', () => {
    const catalog = new Map<string, AntigravityModelInfo>([
      ['gemini-3-flash-agent', model({
        key: 'gemini-3-flash-agent', enum: 'MODEL_35_HIGH', displayName: 'Gemini 3.5 Flash (High)',
      })],
      ['gemini-3.8-flash-agent', model({
        key: 'gemini-3.8-flash-agent', enum: 'MODEL_38', displayName: 'Gemini 3.8 Flash',
      })],
    ]);
    const entitled = new Set(['MODEL_35_HIGH', 'MODEL_38']);

    expect(selectGeminiModels(catalog, entitled)).toEqual([
      { key: 'gemini-3.8-flash-agent', displayName: 'Gemini 3.8 Flash' },
    ]);
  });

  it('still excludes non-Google entries and unentitled 3.8 Flash models', () => {
    const catalog = new Map<string, AntigravityModelInfo>([
      ['claude-something', model({
        key: 'claude-something', enum: 'MODEL_CLAUDE', displayName: 'Gemini 3.8 Flash',
        apiProvider: 'API_PROVIDER_ANTHROPIC',
      })],
      ['gemini-3.8-flash-agent', model({
        key: 'gemini-3.8-flash-agent', enum: 'MODEL_38', displayName: 'Gemini 3.8 Flash',
      })],
    ]);
    const entitled = new Set(['MODEL_CLAUDE']);

    expect(selectGeminiModels(catalog, entitled)).toEqual([]);
  });
});

describe('SEED_GEMINI_MODELS', () => {
  it('offers only Gemini 3.8 Flash as the pre-discovery fallback', () => {
    expect(SEED_GEMINI_MODELS).toEqual([
      { key: 'gemini-3.8-flash-agent', displayName: 'Gemini 3.8 Flash' },
    ]);
  });
});
