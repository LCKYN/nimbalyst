import { laneColorIndex, type CommitGraphRow } from '../graphLayout';

const LANE_WIDTH = 14;
const ROW_HEIGHT = 28;
const DOT_RADIUS = 3.5;

const LANE_COLORS = [
  'var(--nim-primary)',
  'var(--nim-success, #4ade80)',
  'var(--nim-warning, #fbbf24)',
  '#a78bfa',
  '#22d3ee',
  '#fb7185',
];

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

/** A compact SVG segment for one row of the Git commit DAG. */
export function CommitGraphCell({ row, highlighted }: { row: CommitGraphRow; highlighted: boolean }) {
  const width = Math.max(row.laneCount, 1) * LANE_WIDTH;
  const middle = ROW_HEIGHT / 2;
  const color = LANE_COLORS[laneColorIndex(row.colorKey, LANE_COLORS.length)];

  return (
    <svg
      className="git-commit-graph"
      width={width}
      height={ROW_HEIGHT}
      viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
      aria-hidden="true"
    >
      {row.lanesBefore.map((_hash, lane) => (
        <line
          key={`top-${lane}`}
          x1={laneX(lane)} y1="0" x2={laneX(lane)} y2={middle}
          stroke={LANE_COLORS[laneColorIndex(row.lanesBeforeColorKeys[lane], LANE_COLORS.length)]}
          strokeWidth="1.7"
        />
      ))}
      {row.parentLanes.map((parentLane) => (
        <path
          key={`parent-${parentLane}`}
          d={`M ${laneX(row.lane)} ${middle} C ${laneX(row.lane)} ${middle + 6}, ${laneX(parentLane)} ${middle + 7}, ${laneX(parentLane)} ${ROW_HEIGHT}`}
          fill="none"
          stroke={color}
          strokeWidth="1.7"
        />
      ))}
      <circle
        cx={laneX(row.lane)} cy={middle} r={DOT_RADIUS}
        fill={highlighted ? 'var(--nim-bg)' : color}
        stroke={color}
        strokeWidth="1.8"
      />
    </svg>
  );
}
