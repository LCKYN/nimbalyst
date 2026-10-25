/** A commit record containing only the relationships needed for graph layout. */
export interface GraphCommit {
  hash: string;
  parents: string[];
}

/** The lanes entering and leaving one row of the commit DAG. */
export interface CommitGraphRow extends GraphCommit {
  /** The column that contains this commit's vertex. */
  lane: number;
  /** Columns its parent edges end in at the bottom of this row. */
  parentLanes: number[];
  /** Commit hashes occupying columns above the vertex. */
  lanesBefore: string[];
  /** Commit hashes occupying columns below the vertex. */
  lanesAfter: string[];
  /** Largest visible lane count for this row. */
  laneCount: number;
  /**
   * Stable color identity for this row's own lane. Unlike `lane` (a column
   * index) or `hash` (changes every row along a branch), this stays constant
   * for the branch's whole lifetime — set once when its lane is created and
   * carried forward as the branch's pending commit advances or its column
   * shifts.
   */
  colorKey: string;
  /** Color identities for each column in `lanesBefore`, same indexing. */
  lanesBeforeColorKeys: string[];
}

/**
 * Assigns a stable, compact lane to each row of a newest-to-oldest Git log.
 *
 * Git emits a topological log, so each parent appears at or below its child.
 * We retain that pending-parent list as lanes: a child replaces its lane with
 * its first parent, while additional merge parents get their own adjacent lane.
 */
export function layoutCommitGraph(commits: readonly GraphCommit[]): CommitGraphRow[] {
  let lanes: string[] = [];
  // Parallel to `lanes`, but holds each lane's original branch identity
  // rather than its next pending commit hash, so color can stay stable while
  // topology (and column position) keeps moving.
  let colorKeys: string[] = [];

  return commits.map((commit) => {
    const knownLane = lanes.indexOf(commit.hash);
    const lane = knownLane >= 0 ? knownLane : lanes.length;
    const colorKey = knownLane >= 0 ? colorKeys[knownLane] : commit.hash;
    if (knownLane < 0) {
      lanes = [...lanes, commit.hash];
      colorKeys = [...colorKeys, colorKey];
    }

    const lanesBefore = lanes;
    const colorKeysBefore = colorKeys;
    const parents = [...new Set((commit.parents ?? []).filter(Boolean))];
    let lanesAfter = [...lanesBefore];
    let colorKeysAfter = [...colorKeysBefore];

    if (parents.length === 0) {
      lanesAfter.splice(lane, 1);
      colorKeysAfter.splice(lane, 1);
    } else {
      lanesAfter[lane] = parents[0];
      let insertionLane = lane + 1;
      for (const parent of parents.slice(1)) {
        if (lanesAfter.includes(parent)) continue;
        lanesAfter.splice(insertionLane, 0, parent);
        // Each additional merge parent is a branch we haven't tracked
        // before, so it gets its own fresh color identity.
        colorKeysAfter.splice(insertionLane, 0, parent);
        insertionLane += 1;
      }
    }

    // A parent can already have an incoming lane (a branch rejoining history).
    // Keep that first lane and collapse duplicates before rendering the next row.
    const keepIndices = lanesAfter
      .map((hash, index) => (lanesAfter.indexOf(hash) === index ? index : -1))
      .filter(index => index >= 0);
    lanesAfter = keepIndices.map(index => lanesAfter[index]);
    colorKeysAfter = keepIndices.map(index => colorKeysAfter[index]);
    const parentLanes = parents
      .map(parent => lanesAfter.indexOf(parent))
      .filter((parentLane): parentLane is number => parentLane >= 0);
    const row: CommitGraphRow = {
      hash: commit.hash,
      parents,
      lane,
      parentLanes,
      lanesBefore,
      lanesAfter,
      laneCount: Math.max(lanesBefore.length, lanesAfter.length, lane + 1),
      colorKey,
      lanesBeforeColorKeys: colorKeysBefore,
    };

    lanes = lanesAfter;
    colorKeys = colorKeysAfter;
    return row;
  });
}

/**
 * Deterministic color-bucket index for the commit hash occupying a lane.
 *
 * Keyed by hash rather than column index so a branch keeps its color as it
 * shifts columns when a lane to its left is removed (e.g. a sibling branch
 * terminating), instead of inheriting whatever branch used to sit in that
 * column.
 */
export function laneColorIndex(hash: string, colorCount: number): number {
  let hashValue = 0;
  for (let i = 0; i < hash.length; i++) {
    hashValue = (hashValue * 31 + hash.charCodeAt(i)) >>> 0;
  }
  return hashValue % colorCount;
}
