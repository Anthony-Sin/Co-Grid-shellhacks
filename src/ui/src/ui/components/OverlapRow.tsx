import { TIERS, TIER_COLORS } from '../../lib/palette'
import { utilityColor } from './utilityColors'
import type { OverlapRecord, ProjectProps } from '../../lib/api'

export type ProjectMap = Map<string, ProjectProps>

type Cls = string | false | null | undefined
const cx = (...c: Cls[]) => c.filter(Boolean).join(' ')

/** tier number → human label (`o.tier_label` is the raw schema token). */
const TIER_LABEL = new Map<number, string>(TIERS.map((t) => [t.tier, t.label]))

/** 0 → "touching", else 1-decimal km (exact value lives in the detail card). */
const fmtKm = (km: number) => (km <= 0 ? 'touching' : `${km.toFixed(1)} km`)
const clampScore = (s: number) => Math.max(0, Math.min(100, s))

export interface RowProps {
  overlap: OverlapRecord; rank: number; selected: boolean; hovered: boolean
  projectById: ProjectMap; onSelect: () => void; onHover: (id: string | null) => void
}

/**
 * One ranked-list row: OV-id + engine rank, colored project names, human
 * tier label, timeline window chip (adjacent windows get the `→` handoff
 * glyph + honesty tooltip), score bar, and closest-point distance.
 */
export function OverlapRow({ overlap: o, rank, selected, hovered, projectById, onSelect, onHover }: RowProps) {
  const a = projectById.get(o.project_a)
  const b = projectById.get(o.project_b)
  const tierColor = TIER_COLORS[o.tier] ?? '#888888'
  const tierLabel = TIER_LABEL.get(o.tier) ?? o.tier_label.replace(/_/g, ' ')

  return (
    <li>
      <button type="button" title={o.explanation} aria-pressed={selected} data-ovid={o.overlap_id}
        className={cx('overlap-row', selected && 'is-selected', hovered && 'is-hovered')}
        onClick={onSelect}
        onMouseEnter={() => onHover(o.overlap_id)}
        onMouseLeave={() => onHover(null)}>
        <span className="pnl-rowmeta mono">
          <span className="pnl-ovid">{o.overlap_id}</span>
          <span className="pnl-ovrank">#{rank}</span>
        </span>
        <span className="ov-main">
          <span className="ov-tier">
            <span className="dot" style={{ background: tierColor }} />
            {tierLabel}
          </span>
          <span className="ov-names">
            <span style={{ color: utilityColor(a?.utility) }}>{a?.name ?? o.project_a}</span>
            <span className="ov-swap" aria-hidden>⇄</span>
            <span style={{ color: utilityColor(b?.utility) }}>{b?.name ?? o.project_b}</span>
          </span>
          <span className="ov-meta">
            {o.timeline_overlap && o.shared_window ? (
              <span className="chip-timeline mono">{o.shared_window.start}–{o.shared_window.end}</span>
            ) : o.timeline_adjacent && o.adjacent_window ? (
              <span className="chip-timeline is-adjacent mono" title="windows roll end-to-start — not a concurrent overlap">
                →{o.adjacent_window.start}–{o.adjacent_window.end}
              </span>
            ) : (
              <span className="chip-timeline is-none">no overlap</span>
            )}
            <span className="score-bar" title={`score ${o.score}`}>
              <span className="score-fill" style={{ width: `${clampScore(o.score)}%`, background: tierColor }} />
            </span>
            <span className="score-num mono">{o.score.toFixed(0)}</span>
          </span>
        </span>
        <span className="ov-dist mono">{fmtKm(o.min_distance_km)}</span>
      </button>
    </li>
  )
}
