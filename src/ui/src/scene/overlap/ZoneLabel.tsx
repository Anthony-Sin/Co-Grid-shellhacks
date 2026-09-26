/**
 * ZoneLabel — floating rank chip above the top coordination opportunities.
 *
 * Parent renders this only for the top-3 scored visible overlaps. The chip
 * hovers ~120m above the zone centroid, reads `T{tier} · {tier_label} ·
 * {min_distance_km}km`, and carries the tier color as a left border so it
 * keys back to the legend. distanceFactor makes it scale with map zoom
 * like an annotation painted on the plan sheet.
 *
 * Non-interactive (pointer-events: none) — never blocks pan/zoom.
 */
import { Html } from '@react-three/drei'
import { PALETTE, TIER_COLORS } from '../../lib/palette'
import type { ZoneDatum } from './zoneData'

/** Label hover height above the zone centroid. */
const LABEL_H = 120

export function ZoneLabel({ datum }: { datum: ZoneDatum }) {
  const color = TIER_COLORS[datum.rec.tier]
  return (
    <Html
      position={[datum.centroid[0], LABEL_H, -datum.centroid[1]]}
      center
      distanceFactor={8}
      zIndexRange={[80, 0]}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 7,
          padding: '6px 14px',
          background: PALETTE.chipBg,
          color: PALETTE.chipText,
          borderRadius: 10,
          borderLeft: `5px solid ${color}`,
          boxShadow: '2px 3px 0 rgba(43, 43, 43, 0.25)',
          whiteSpace: 'nowrap',
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        T{datum.rec.tier} · {datum.rec.tier_label.replace(/_/g, ' ')} ·{' '}
        {datum.rec.min_distance_km.toFixed(1)} km
      </div>
    </Html>
  )
}
