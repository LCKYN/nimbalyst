import type { ShellCoverageReason } from '@nimbalyst/runtime/ai/shellTrackingCoverage';
import type { ShellCheckoutBaseline } from './ShellCheckoutBaseline';
import { boundedDrain } from './ShellTrackingCoverage';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export interface ShellFileState {
  fingerprint: string;
  modifiedAt: number;
}
export interface ShellFileEvidence {
  sessionId: string;
  workspacePath: string;
  filePath: string;
  toolUseId: string;
  timestamp: number;
  source: 'shell-hook-inferred';
}
export type ShellPersistenceOutcome = 'persisted' | 'excluded' | 'throttled' | 'quota' | 'failed';
export class ExcludedShellCandidate extends Error {}
export interface ShellAttributionDependencies {
  subscribe(workspace: string, changed: (file: string, observedAt?: number) => void): Promise<() => void>;
  prepareCheckout?(workspace: string): Promise<ShellCheckoutBaseline | undefined>;
  drainEvents?(workspace: string): Promise<void>;
  observation?(generation: string, healthy: boolean): void;
  read(file: string): Promise<ShellFileState | null>;
  knownWrite(file: string, state: ShellFileState | null): boolean;
  otherSessions(workspace: string, filePath: string): string[];
  persist(evidence: ShellFileEvidence): Promise<ShellPersistenceOutcome>;
  report?(generation: string, reason: ShellCoverageReason, turnId?: string, toolUseId?: string): void;
  currentTurn?(generation: string): string | undefined;
  retryDelayMs?: number;
  now?: () => number;
  settleMs?: number;
}
export class ShellFileAttribution {
  private readonly sessions = new Map<string, { sessionId: string; workspace: string }>();
  private readonly workspaces = new Map<string, Promise<() => void>>();
  private readonly windows = new Map<
    string,
    {
      generation: string;
      id: string;
      tool: string;
      start: number;
      files: Set<string>;
      observation: { lost: boolean };
      checkout?: ShellCheckoutBaseline;
      deferred: Map<string, { evidence: ShellFileEvidence; fingerprint: string | null; turnId?: string }>;
    }
  >();
  private readonly terminal = new Map<string, Set<string>>();
  private readonly observed = new Map<string, Set<string>>();
  private readonly closing = new Map<string, Promise<void>>();
  private readonly cache = new Map<string, string | null>();
  private readonly stats = { ambiguous: 0, suppressed: 0, overflow: 0 };
  private readonly disabled = new Set<string>();
  private readonly unhealthy = new Set<string>();
  private pending = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  constructor(private readonly deps: ShellAttributionDependencies) {
    this.now = deps.now ?? Date.now;
  }

  async register(sessionId: string, workspacePath: string): Promise<string> {
    const workspace = path.resolve(workspacePath),
      generation = randomUUID();
    this.sessions.set(generation, { sessionId, workspace });
    this.terminal.set(generation, new Set());
    this.observed.set(generation, new Set());
    if (!this.workspaces.has(workspace))
      this.workspaces.set(
        workspace,
        this.deps.subscribe(workspace, (file, observedAt) => this.changed(workspace, file, observedAt))
      );
    try {
      await this.workspaces.get(workspace);
    } catch (error) {
      this.sessions.delete(generation);
      this.terminal.delete(generation);
      this.observed.delete(generation);
      this.workspaces.delete(workspace);
      throw error;
    }
    return generation;
  }
  async pre(generation: string, id: string, tool: string): Promise<void> {
    if (!this.sessions.has(generation) || !id || id.length > 256) return;
    // Terminal app-server notifications do not wait for our watcher drain.
    // Finish retiring those tools before allowing another command to execute.
    const drained = await this.drain([this.sessions.get(generation)?.sessionId ?? ''], 1500);
    if (!drained) {
      this.disabled.add(generation);
      return;
    }
    if (!this.sessions.has(generation) || !id || id.length > 256) return;
    if (this.terminal.get(generation)?.has(id)) {
      this.report(generation, 'staleEvent');
      return;
    }
    // A bounded per-generation registry. Missing post hooks never grow it
    // without limit; at the cap tracking abstains until lifecycle cleanup.
    if (this.windows.size >= 256) {
      this.stats.overflow++;
      this.report(generation, 'overflow');
      this.disabled.add(generation);
      return;
    }
    let checkout: ShellCheckoutBaseline | undefined;
    const captured = tool !== 'Bash' || await boundedDrain(
      Promise.resolve(this.deps.prepareCheckout?.(this.sessions.get(generation)!.workspace)).then(value => { checkout = value; }), 750);
    if (!this.sessions.has(generation) || this.terminal.get(generation)?.has(id)) return;
    if (!captured) this.report(generation, 'checkoutBaseline', undefined, id);
    if (this.unhealthy.has(this.sessions.get(generation)!.workspace)) this.report(generation, 'watcherLoss');
    this.observed.get(generation)?.add(id);
    const key = generation + '|' + id;
    if (!this.windows.has(key) || this.windows.get(key)?.tool === 'Uninstrumented')
      this.windows.set(key, {
        generation,
        id,
        tool,
        start: this.now(),
        files: new Set(),
        observation: { lost: !captured || this.unhealthy.has(this.sessions.get(generation)!.workspace) },
        checkout,
        deferred: new Map(),
      });
  }
  watcherLost(workspace: string): void {
    this.unhealthy.add(workspace);
    const affected = new Set<string>();
    for (const window of this.windows.values()) {
      if (this.sessions.get(window.generation)?.workspace === workspace) {
        window.observation.lost = true;
        affected.add(window.generation);
      }
    }
    for (const [generation, session] of this.sessions) if (session.workspace === workspace) {
      this.deps.observation?.(generation, false);
      if (affected.has(generation)) this.report(generation, 'watcherLoss');
    }
    for (const file of this.cache.keys()) if (this.contains(workspace, file)) this.cache.delete(file);
  }
  watcherRecovered(workspace: string): void {
    this.unhealthy.delete(workspace);
    for (const [generation, session] of this.sessions) if (session.workspace === workspace)
      this.deps.observation?.(generation, true);
    // Interrupted windows remain ineligible until their own terminal boundary.
  }
  private report(generation: string, reason: ShellCoverageReason, turnId?: string, toolUseId?: string): void {
    this.deps.report?.(generation, reason, turnId, toolUseId);
  }
  started(generation: string, id: string): void {
    if (!this.sessions.has(generation) || this.terminal.get(generation)?.has(id)) return;
    const key = generation + '|' + id;
    if (this.windows.has(key)) return;
    if (this.windows.size >= 256) {
      this.disabled.add(generation);
      this.report(generation, 'overflow');
      return;
    }
    // A notification is not a pre-execution barrier. It can only guard against
    // attributing an uninstrumented execution's writes to another open tool.
    this.windows.set(key, {
      generation,
      id,
      tool: 'Uninstrumented',
      start: this.now(),
      files: new Set(),
      observation: { lost: this.unhealthy.has(this.sessions.get(generation)!.workspace) },
      deferred: new Map(),
    });
  }
  completed(generation: string, id: string): Promise<void> {
    if (!this.sessions.has(generation) || this.terminal.get(generation)?.has(id)) return Promise.resolve();
    if (!this.observed.get(generation)?.has(id)) this.report(generation, 'missingPre', undefined, id);
    this.rememberTerminal(generation, id);
    return this.post(generation, id);
  }
  private rememberTerminal(generation: string, id: string): void {
    const seen = this.terminal.get(generation);
    if (!seen) return;
    seen.add(id);
    if (seen.size > 2048) {
      seen.delete(seen.values().next().value!);
      this.disabled.add(generation);
      this.report(generation, 'overflow');
    }
    this.observed.get(generation)?.delete(id);
  }
  async drain(sessionIds: string[], timeoutMs = 1500): Promise<boolean> {
    const work = async () => {
      do {
        await Promise.all([...new Set([...this.sessions.values()].map(s => s.workspace))].map(w => this.deps.drainEvents?.(w)));
        await Promise.all(this.closing.values());
        const queue = this.queue;
        await queue;
        if (!this.closing.size && queue === this.queue) return;
      } while (true);
    };
    const success = await boundedDrain(work(), timeoutMs);
    if (!success)
      for (const [generation, session] of this.sessions) {
        if (sessionIds.includes(session.sessionId)) this.report(generation, 'drainTimeout');
      }
    return success;
  }
  post(generation: string, id: string): Promise<void> {
    // Shared bus delivery includes atomic-write/debounce delays on Linux.
    // Keep the window open while draining; this is inference, not an OS barrier.
    const key = generation + '|' + id;
    const closing = this.closing.get(key);
    if (closing) return closing;
    const window = this.windows.get(key);
    if (!window) return Promise.resolve();
    this.rememberTerminal(generation, id);
    const drain = (async () => {
      await new Promise((r) => setTimeout(r, this.deps.settleMs ?? 150));
      const workspace = this.sessions.get(generation)?.workspace;
      if (workspace) await this.deps.drainEvents?.(workspace);
      await this.flush();
      if (window.checkout && window.deferred.size && !window.observation.lost && this.sessions.has(generation)) {
        try {
          const candidates = [...window.deferred.values()];
          const results = await window.checkout.finish(candidates.map(c => ({ filePath: c.evidence.filePath, fingerprint: c.fingerprint })));
          for (const candidate of candidates) {
            if (window.observation.lost || this.disabled.has(generation) || !this.sessions.has(generation)) break;
            const result = results.get(candidate.evidence.filePath);
            if (result === 'edit') {
              if (window.files.size >= 500) {
                this.report(generation, 'overflow', candidate.turnId, id);
                break;
              }
              await this.save(candidate.evidence, generation, candidate.turnId, window.files);
            }
            else this.report(generation, result === 'initialization' ? 'initialization' : 'checkoutBaseline', candidate.turnId);
          }
        } catch {
          this.report(generation, 'checkoutBaseline', undefined, id);
        }
      }
      if (this.windows.get(key) === window) this.windows.delete(key);
    })().finally(() => this.closing.delete(key));
    this.closing.set(key, drain);
    return drain;
  }
  async flush(): Promise<void> {
    for (;;) {
      const queue = this.queue;
      await queue;
      if (queue === this.queue) return;
    }
  }
  endTurn(generation: string): void {
    for (const [key, w] of this.windows)
      if (w.generation === generation) {
        if (!this.closing.has(key)) {
          w.observation.lost = true;
          this.report(generation, 'unmatchedTool', undefined, w.id);
        }
        this.rememberTerminal(generation, w.id);
        this.windows.delete(key);
      }
    this.observed.get(generation)?.clear();
    this.disabled.delete(generation);
  }
  async release(generation: string): Promise<void> {
    const s = this.sessions.get(generation);
    this.endTurn(generation);
    this.sessions.delete(generation);
    this.terminal.delete(generation);
    this.observed.delete(generation);
    this.disabled.delete(generation);
    for (const [key, w] of this.windows) if (w.generation === generation) this.windows.delete(key);
    await boundedDrain(this.flush(), 1500);
    if (s && ![...this.sessions.values()].some((x) => x.workspace === s.workspace)) {
      const release = await this.workspaces.get(s.workspace);
      release?.();
      this.workspaces.delete(s.workspace);
      for (const file of this.cache.keys()) if (this.contains(s.workspace, file)) this.cache.delete(file);
    }
  }
  getStats() {
    return {
      ...this.stats,
      pending: this.pending,
      activeWindows: this.windows.size,
      cachedFiles: this.cache.size,
    };
  }
  private contains(workspace: string, file: string): boolean {
    const rel = path.relative(workspace, file);
    return !!rel && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
  }
  private changed(workspace: string, rawPath: string, observedAt = this.now()): void {
    const filePath = path.resolve(rawPath);
    if (!this.contains(workspace, filePath)) return;
    if (this.pending >= 16_384) {
      this.stats.overflow++;
      for (const [generation, s] of this.sessions)
        if (this.contains(s.workspace, filePath)) {
          this.disabled.add(generation);
          this.report(generation, 'overflow');
        }
      return;
    }
    const timestamp = observedAt;
    // Freeze the candidates now: a later post hook must not turn an overlap
    // into a single-owner event while the filesystem read waits in the queue.
    const candidates = [...this.windows.values()]
      .filter((w) => {
        const s = this.sessions.get(w.generation);
        return s && w.start <= timestamp && this.contains(s.workspace, filePath);
      })
      .map((w) => ({
        ...w,
        sessionId: this.sessions.get(w.generation)!.sessionId,
        turnId: this.deps.currentTurn?.(w.generation),
      }));
    // Idle cached providers must not hash every workspace event. Invalidate a
    // known baseline so a later command cannot inherit an unobserved change.
    if (candidates.length === 0) {
      this.cache.delete(filePath);
      return;
    }
    const disabledAtArrival = this.unhealthy.has(workspace) || candidates.some(w => w.observation.lost) || [...this.disabled].some((g) => {
      const s = this.sessions.get(g);
      return s && this.contains(s.workspace, filePath);
    });
    const registered = new Set(
      [...this.sessions.values()].filter((s) => this.contains(s.workspace, filePath)).map((s) => s.sessionId)
    );
    const hasUninstrumentedSession = this.deps
      .otherSessions(workspace, filePath)
      .some((id) => !registered.has(id));
    this.pending++;
    this.queue = this.queue
      .then(async () => {
        const state = await this.deps.read(filePath),
          fingerprint = state?.fingerprint ?? null;
        const cached = this.cache.get(filePath);
        this.cache.delete(filePath);
        this.cache.set(filePath, fingerprint);
        if (this.cache.size > 2048) this.cache.delete(this.cache.keys().next().value!);
        if (cached !== undefined && cached === fingerprint) return;
        if (this.deps.knownWrite(filePath, state)) {
          this.stats.suppressed++;
          for (const generation of new Set(candidates.map((w) => w.generation)))
            this.report(
              generation,
              'knownWrite',
              candidates.find((w) => w.generation === generation)?.turnId,
                candidates.find((w) => w.generation === generation)?.id
            );
          return;
        }
        if (candidates.length === 0) return;
        const owners = new Set(candidates.map((w) => w.sessionId));
        if (
          hasUninstrumentedSession ||
          disabledAtArrival ||
          owners.size !== 1 ||
          candidates.some((w) => w.tool !== 'Bash' || w.observation.lost || this.disabled.has(w.generation))
        ) {
          this.stats.ambiguous++;
          if (candidates.some((w) => w.tool === 'Bash' || w.tool === 'Uninstrumented'))
            for (const generation of new Set(candidates.map((w) => w.generation)))
              this.report(
                generation,
                hasUninstrumentedSession ? 'uninstrumented' :
                  disabledAtArrival || candidates.some(w => w.observation.lost || this.disabled.has(w.generation)) ? 'observationGap' :
                  owners.size !== 1 ? 'competingOwners' : 'toolOverlap',
                candidates.find((w) => w.generation === generation)?.turnId,
                candidates.find((w) => w.generation === generation)?.id
              );
          return;
        }
        const winner = candidates.find((w) => this.sessions.has(w.generation));
        if (!winner) return;
        // A metadata-only notification for an old file is not a new edit. An
        // uncached disappearance might be a directory; only known files qualify.
        if (state && state.modifiedAt <= winner.start) return;
        if (winner.files.has(filePath)) return;
        const session = this.sessions.get(winner.generation);
        if (!session) return;
        if (winner.files.size >= 500) {
          this.stats.overflow++;
          this.disabled.add(winner.generation);
          this.report(winner.generation, 'overflow');
          return;
        }
        const evidence: ShellFileEvidence = {
          sessionId: session.sessionId,
          workspacePath: session.workspace,
          filePath,
          toolUseId: winner.id,
          timestamp,
          source: 'shell-hook-inferred',
        };
        if (winner.checkout) {
          let defer: boolean;
          try { defer = await winner.checkout.defer(filePath); }
          catch { this.report(winner.generation, 'checkoutBaseline', winner.turnId, winner.id); return; }
          if (defer) {
            if (winner.deferred.size >= 16_384 && !winner.deferred.has(filePath)) {
              winner.observation.lost = true;
              this.report(winner.generation, 'overflow', winner.turnId);
              return;
            }
            winner.deferred.set(filePath, { evidence, fingerprint, turnId: winner.turnId });
            return;
          }
        }
        if (!state && (cached === undefined || cached === null)) return;
        if (winner.observation.lost || this.disabled.has(winner.generation) || !this.sessions.has(winner.generation)) return;
        await this.save(evidence, winner.generation, winner.turnId, winner.files);
      })
      .catch((error) => {
        for (const generation of new Set(candidates.map((w) => w.generation)))
          this.report(
            generation,
            error instanceof ExcludedShellCandidate ? 'excluded' : 'readFailure',
            candidates.find((w) => w.generation === generation)?.turnId,
                candidates.find((w) => w.generation === generation)?.id
          );
        this.stats.suppressed++;
      })
      .finally(() => {
        this.pending--;
      });
  }
  private async save(evidence: ShellFileEvidence, generation: string, turnId: string | undefined, files: Set<string>): Promise<void> {
    let outcome: ShellPersistenceOutcome = 'failed';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        outcome = await this.deps.persist(evidence);
      } catch {
        outcome = 'failed';
      }
      if (outcome !== 'failed' && outcome !== 'throttled') break;
      if (attempt < 2)
        await new Promise((r) => setTimeout(r, this.deps.retryDelayMs ?? 100 * (attempt + 1)));
    }
    if (outcome === 'persisted') files.add(evidence.filePath);
    else {
      this.cache.delete(evidence.filePath);
      this.report(generation, outcome === 'failed' ? 'persistence' : outcome, turnId, evidence.toolUseId);
    }
  }
}
