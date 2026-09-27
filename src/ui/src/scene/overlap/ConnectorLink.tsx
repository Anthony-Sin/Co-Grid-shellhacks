/**
 * ConnectorLink — the 3D arc tying an overlap's two projects together.
 *
 * A quadratic-bezier arc (apex ~80–160m, scaled by A–B distance) between
 * closest_point_a and closest_point_b in tier color, with dark ink dots at
 * each endpoint (h≈30m) and a floating midpoint pill chip:
 *   `GPC ⇄ DESC · 4.4 km` — clickable, toggles selectOverlap().
 *
 * `faint` renders the arc thin + dashed (timeline-filtered records stay
 * honest — flagged, not erased). `dimmed` sinks it to ~40% opacity while
 * another overlap is selected; `selected` pushes it to full brightness;
 * `highlighted` (hover brushing) eases ~70% of the way there.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { Html, Line } from '@react-three/drei'
import { PALETTE, TIER_COLORS } from '../../lib/palette'
import { selectOverlapInScene } from '../../lib/selectOverlap'
import type { ZoneDatum } from './zoneData'

/** Height of arc endpoints + ink dots above the map. */
const END_H = 30
/** Chip hover offset above the arc apex. */
const CHIP_LIFT = 34
const DIM_FACTOR = 0.4
/** Fraction of the full "selected" treatment used for hover-highlighting. */
const HIGHLIGHT_F = 0.7

export interface ConnectorLinkProps {
  datum: ZoneDatum
  dimmed: boolean
  selected: boolean
  /** Hover-brushed from the list/map — ~70% of the selected styling. */
  highlighted: boolean
  /** Timeline-filtered record → thin dashed arc. */
  faint: boolean
  /** labels layer toggle — hides the midpoint pill chip when false. */
  showChip?: boolean
}

export function ConnectorLink({ datum, dimmed, selected, highlighted, faint, showChip = true }: ConnectorLinkProps) {
  const color = TIER_COLORS[datum.rec.tier] ?? '#888888'

  const a = useMemo(
    () => new THREE.Vector3(datum.aLocal[0], END_H, -datum.aLocal[1]),
    [datum],
  )
  const b = useMemo(
    () => new THREE.Vector3(datum.bLocal[0], END_H, -datum.bLocal[1]),
    [datum],
  )

  // Quadratic bezier: endpoints at END_H, control lifted by dist-scaled apex.
  const { pts, chipPos } = useMemo(() => {
    const apex = THREE.MathUtils.clamp(datum.distM * 0.28, 80, 160)
    const ctrl = a.clone().add(b).multiplyScalar(0.5)
    ctrl.y = END_H + apex
    const curve = new THREE.QuadraticBezierCurve3(a, ctrl, b)
    const chip = curve.getPoint(0.5)
    chip.y += CHIP_LIFT
    // Touching records share a midpoint — spread their chips vertically by
    // a deterministic phase so the pills don't stack into a blob.
    chip.y += datum.phase * 22
    return { pts: curve.getPoints(48), chipPos: chip }
  }, [a, b, datum])

  /** Hover-brush strength: 1 selected, ~0.7 hovered, 0 at rest. */
  const boost = selected ? 1 : highlighted ? HIGHLIGHT_F : 0
  const arcOpacity = (faint ? 0.45 : 0.9 + 0.1 * boost) * (dimmed ? DIM_FACTOR : 1)
  const dotOpacity = 0.95 * (dimmed ? DIM_FACTOR : 1)

  return (
    <group>
      {/* tier-1 "touching" records have identical endpoints — no arc to draw */}
      {datum.distM > 1 && (
        <Line
          points={pts}
          color={color}
          lineWidth={faint ? 1.25 : 2.5 + 0.75 * boost}
          dashed={faint}
          dashSize={140}
          gapSize={90}
          transparent
          opacity={arcOpacity}
          renderOrder={14}
        />
      )}

      {/* ink-dot endpoints at h≈30m */}
      {[a, b].map((p, i) => (
        <mesh key={i} position={p} renderOrder={15}>
          <sphereGeometry args={[9, 14, 10]} />
          <meshBasicMaterial color={PALETTE.ink} transparent opacity={dotOpacity} />
        </mesh>
      ))}

      {/* midpoint pill chip — click toggles the selection
          (hidden when the labels layer is off) */}
      {showChip && (
        <Html position={chipPos} center zIndexRange={[80, 0]}>
          <button
            type="button"
            onClick={() =>
              selectOverlapInScene(selected ? null : datum.rec.overlap_id, datum.rec.zone)
            }
            title={datum.rec.explanation}
            style={{
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 6,
              padding: '5px 12px',
              background: PALETTE.chipBg,
              color: PALETTE.chipText,
              border: 'none',
              borderLeft: `4px solid ${color}`,
              borderRadius: 999,
              boxShadow: '2px 3px 0 rgba(43, 43, 43, 0.25)',
              whiteSpace: 'nowrap',
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              opacity: (dimmed ? DIM_FACTOR : 1) * (faint ? 0.55 + 0.45 * boost : 1),
              transform: `scale(${1 + 0.1 * boost})`,
              transition: 'transform 140ms ease, opacity 140ms ease',
            }}
          >
            T{datum.rec.tier} · {datum.labelA} ⇄ {datum.labelB} · {datum.rec.min_distance_km.toFixed(1)} km
          </button>
        </Html>
      )}
    </group>
  )
}
