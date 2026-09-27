/**
 * OverlapLines — the line-centric overlap markup. This is the PRIMARY
 * signal at statewide overview (where zone circles are not drawn) and it
 * stays on at corridor zoom alongside the soft zone overlays:
 *
 *  - GLOW UNDERLAYS — a constant-width translucent stroke retracing each
 *    involved planned line in the record's tier color. All records are
 *    merged into ONE segments draw per (tier × timeline-flag) bucket, so
 *    ~200 rendered overlaps cost ~a dozen draw calls. The stroke sits at
 *    conductor height with a lower renderOrder than the 3.5px utility
 *    wire, so the wire reads centered inside its own halo. Tier-1
 *    "touching" records get a wider, near-solid red halo — unmistakable
 *    next to a plain planned line.
 *  - CLOSEST-POINT DOTS — screen-space sprites (THREE.Points with
 *    sizeAttenuation off; a ~10m mesh is sub-pixel at statewide scale,
 *    so markers live in px like the wires). Tier-1 gets a 3-sprite
 *    bullseye (red ring + paper gap + red core) at the touching point.
 *  - SITE DOTS — point-sited involved projects (substation/plant filings
 *    with no route to stroke) get a tier-colored dot at the site.
 *
 * Selection/hover semantics mirror the zone layer: a live selection dims
 * the merged layer (~40%) while the selected (or hovered) record breaks
 * out with a bigger, brighter mark. timeline-flagged records render
 * fainter (flagged, not erased — AGENTS.md §7).
 *
 * Honesty: wires come from the real filed project geometry, and a side
 * whose project is hidden by the panel's project filters draws nothing —
 * no phantom lines. The closest-point dots are record data and render
 * even when the projects layer is off.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { PALETTE, TIER_COLORS } from '../../lib/palette'
import { useDispose } from '../city/cityUtils'
import type { ProjectGeom, V3, ZoneDatum } from './zoneData'

/** Opacity floor while another overlap is selected (matches zones). */
const DIM_FACTOR = 0.4
/** Extra fade for records failing the timelineOnly flag (flagged, not erased). */
const FAINT_FACTOR = 0.5
/** Hover-brush strength — mirrors ZonePolygon/ConnectorLink. */
const HIGHLIGHT_F = 0.7
/** Screen-space halo width under the wire (the wire itself is 3.5px). */
const GLOW_W: Record<number, number> = { 1: 12, 2: 9, 3: 9, 4: 9 }
const GLOW_OP: Record<number, number> = { 1: 0.9, 2: 0.5, 3: 0.4, 4: 0.32 }
const SEL_W = 14
const SEL_OP = 0.95
const HOV_W = 11
/** Closest-point dots float at conductor height, same as arc endpoints. */
const DOT_H = 30
const SITE_H = 24
/** Sprite sizes (px) — tier-1 renders as a bullseye stack instead. */
const DOT_SIZE: Record<number, number> = { 2: 8.5, 3: 8.5, 4: 7.5 }
const BULL_OUTER = 15
const BULL_MID = 8
const BULL_INNER = 4.5
const SITE_DOT = 7
/** Selected/hovered record markers — a bigger pin at each closest point. */
const BOOST_OUTER = 15
const BOOST_INNER = 6
const BOOST_BULL = { outer: 20, mid: 11, inner: 5.5 }

/** Glows render first in the transparent pass → utility wires paint over
 *  them, leaving the halo around the line. Dots sit above the arcs. */
const ORDER_GLOW = -1
const ORDER_BOOST = 0
const ORDER_SITE = 13
const ORDER_DOT = 16

/** Round sprite shared by every dot cloud: tinted core + ink rim so the
 *  marker stays legible on the bright paper at any tier color. */
let dotTex: THREE.Texture | null = null
function dotTexture(): THREE.Texture {
  if (!dotTex) {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')
    if (g) {
      g.clearRect(0, 0, 64, 64)
      g.beginPath()
      g.arc(32, 32, 26, 0, Math.PI * 2)
      g.fillStyle = '#2B2B2B'
      g.fill()
      g.beginPath()
      g.arc(32, 32, 19, 0, Math.PI * 2)
      g.fillStyle = '#FFFFFF'
      g.fill()
    }
    dotTex = new THREE.CanvasTexture(c)
  }
  return dotTex
}

interface SegBucket {
  /** stable React key — `${tier}:${faint}` (opacity is a prop, not an
   *  identity: keying on it would rebuild the Line2 on every dim flip) */
  key: string
  color: string
  width: number
  opacity: number
  pts: V3[]
}

/** Expand a wire polyline into consecutive segment pairs for <Line segments>. */
function pushSegments(poly: V3[], out: V3[]) {
  for (let i = 0; i + 1 < poly.length; i++) {
    out.push(poly[i], poly[i + 1])
  }
}

export interface OverlapLinesProps {
  /** records that survived the shared hard filters + render cap */
  datums: readonly ZoneDatum[]
  /** project_id → projected wire/site geometry (null while loading) */
  geomById: Map<string, ProjectGeom> | null
  /** project_id → passes the shared project predicate (no phantom lines) */
  projectOk: Map<string, boolean> | null
  selectedId: string | null
  hoveredId: string | null
  /** a live selection dims the merged layer (same as the zones) */
  dimmed: boolean
  /** timelineOnly flag — non-matching records draw fainter */
  timelineOnly: boolean
  /** planned-projects layer toggle gates the line glows + site dots;
   *  closest-point dots are record markup and always render */
  showLines: boolean
}

/** One screen-space dot cloud — positions as flat [x,y,z,...]. */
function DotCloud({
  positions,
  color,
  size,
  opacity,
  order,
}: {
  positions: Float32Array
  color: string
  size: number
  opacity: number
  order: number
}) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return g
  }, [positions])
  useDispose(geom)
  if (positions.length === 0) return null
  return (
    <points geometry={geom} renderOrder={order} frustumCulled={false}>
      <pointsMaterial
        map={dotTexture()}
        color={color}
        size={size}
        sizeAttenuation={false}
        transparent
        opacity={opacity}
        depthWrite={false}
        alphaTest={0.4}
      />
    </points>
  )
}

export function OverlapLines({
  datums,
  geomById,
  projectOk,
  selectedId,
  hoveredId,
  dimmed,
  timelineOnly,
  showLines,
}: OverlapLinesProps) {
  const faint = (d: ZoneDatum) => timelineOnly && !d.rec.timeline_overlap

  /** Merged glow segments per `${tier}:${faint}` bucket — every rendered
   *  record contributes; selected/hovered also get a brighter breakout. */
  const glowBuckets = useMemo<SegBucket[]>(() => {
    const byKey = new Map<string, V3[]>()
    if (geomById && projectOk && showLines) {
      for (const d of datums) {
        const key = `${d.rec.tier}:${faint(d) ? 1 : 0}`
        let arr = byKey.get(key)
        if (!arr) {
          arr = []
          byKey.set(key, arr)
        }
        for (const pid of [d.rec.project_a, d.rec.project_b]) {
          if (projectOk.get(pid) !== true) continue
          const g = geomById.get(pid)
          if (!g) continue
          for (const poly of g.wires) pushSegments(poly, arr)
        }
      }
    }
    const out: SegBucket[] = []
    for (const [key, pts] of byKey) {
      if (pts.length === 0) continue
      const [tier, f] = key.split(':').map(Number)
      out.push({
        key,
        color: TIER_COLORS[tier as keyof typeof TIER_COLORS] ?? '#888888',
        width: GLOW_W[tier] ?? 9,
        opacity: (GLOW_OP[tier] ?? 0.4) * (f ? FAINT_FACTOR : 1) * (dimmed ? DIM_FACTOR : 1),
        pts,
      })
    }
    return out
  }, [datums, geomById, projectOk, showLines, timelineOnly, dimmed])

  /** Site dots (point-sited involved projects) per `${tier}:${faint}`. */
  const siteBuckets = useMemo(() => {
    const byKey = new Map<string, number[]>()
    if (geomById && projectOk && showLines) {
      for (const d of datums) {
        const key = `${d.rec.tier}:${faint(d) ? 1 : 0}`
        let arr = byKey.get(key)
        if (!arr) {
          arr = []
          byKey.set(key, arr)
        }
        for (const pid of [d.rec.project_a, d.rec.project_b]) {
          if (projectOk.get(pid) !== true) continue
          const g = geomById.get(pid)
          if (!g) continue
          for (const [x, y] of g.sites) arr.push(x, SITE_H, -y)
        }
      }
    }
    const out: { color: string; opacity: number; positions: Float32Array }[] = []
    for (const [key, flat] of byKey) {
      if (flat.length === 0) continue
      const [tier, f] = key.split(':').map(Number)
      out.push({
        color: TIER_COLORS[tier as keyof typeof TIER_COLORS] ?? '#888888',
        opacity: 0.9 * (f ? FAINT_FACTOR : 1) * (dimmed ? DIM_FACTOR : 1),
        positions: Float32Array.from(flat),
      })
    }
    return out
  }, [datums, geomById, projectOk, showLines, timelineOnly, dimmed])

  /** Closest-point dots per `${tier}:${faint}` — record-level markup,
   *  always drawn (even with the projects layer off). Tier-1 touching
   *  records collapse to ONE marker at the shared point and render as a
   *  three-sprite bullseye (red ring, paper gap, red core). */
  const dotBuckets = useMemo(() => {
    interface DotLayer {
      key: string
      color: string
      size: number
      opacity: number
      positions: Float32Array
    }
    const byKey = new Map<string, number[]>()
    const put = (key: string, p: readonly number[]) => {
      let arr = byKey.get(key)
      if (!arr) {
        arr = []
        byKey.set(key, arr)
      }
      arr.push(p[0], DOT_H, -p[1])
    }
    for (const d of datums) {
      const key = `${d.rec.tier}:${faint(d) ? 1 : 0}`
      put(key, d.aLocal)
      // touching records share one point — a single marker is honest
      if (d.distM > 1) put(key, d.bLocal)
    }
    const out: DotLayer[] = []
    for (const [key, flat] of byKey) {
      if (flat.length === 0) continue
      const [tier, f] = key.split(':').map(Number)
      const color = TIER_COLORS[tier as keyof typeof TIER_COLORS] ?? '#888888'
      const op = 0.9 * (f ? FAINT_FACTOR : 1) * (dimmed ? DIM_FACTOR : 1)
      const positions = Float32Array.from(flat)
      if (tier === 1) {
        out.push(
          { key: `${key}-o`, color, size: BULL_OUTER, opacity: Math.min(1, op + 0.05), positions },
          { key: `${key}-m`, color: PALETTE.paper, size: BULL_MID, opacity: Math.min(1, op + 0.05), positions },
          { key: `${key}-i`, color, size: BULL_INNER, opacity: Math.min(1, op + 0.05), positions },
        )
      } else {
        out.push({ key, color, size: DOT_SIZE[tier] ?? 8, opacity: op, positions })
      }
    }
    return out
  }, [datums, timelineOnly, dimmed])

  /** Breakout marks for the selected / hovered records: brighter glow
   *  segments + a bigger pin (or scaled bullseye for tier-1). */
  const boost = useMemo(() => {
    const forId = (id: string | null, strong: boolean) => {
      if (!id) return null
      const d = datums.find((x) => x.rec.overlap_id === id)
      if (!d) return null
      const color = TIER_COLORS[d.rec.tier] ?? '#888888'
      const pts: V3[] = []
      if (geomById && projectOk && showLines) {
        for (const pid of [d.rec.project_a, d.rec.project_b]) {
          if (projectOk.get(pid) !== true) continue
          const g = geomById.get(pid)
          if (!g) continue
          for (const poly of g.wires) pushSegments(poly, pts)
        }
      }
      const pins: Float32Array = Float32Array.from(
        (d.rec.tier === 1 && d.distM <= 1
          ? [d.aLocal]
          : [d.aLocal, d.bLocal]
        ).flatMap((p) => [p[0], DOT_H + 2, -p[1]]),
      )
      // a timeline-flagged record keeps its "flagged" fade even when
      // selected/hovered — honest, matching the dashed zone outline
      const f = faint(d) ? FAINT_FACTOR : 1
      return { d, color, pts, pins, strong, f }
    }
    const sel = forId(selectedId, true)
    const hov =
      hoveredId && hoveredId !== selectedId ? forId(hoveredId, false) : null
    return { sel, hov }
  }, [datums, geomById, projectOk, showLines, selectedId, hoveredId, timelineOnly])

  return (
    <group>
      {/* merged tier-colored halos under the planned wires */}
      {glowBuckets.map((b) => (
        <Line
          key={b.key}
          segments
          points={b.pts}
          color={b.color}
          lineWidth={b.width}
          transparent
          opacity={b.opacity}
          depthWrite={false}
          renderOrder={ORDER_GLOW}
        />
      ))}
      {boost.hov && boost.hov.pts.length > 0 && (
        <Line
          segments
          points={boost.hov.pts}
          color={boost.hov.color}
          lineWidth={HOV_W}
          transparent
          opacity={Math.min(1, (GLOW_OP[boost.hov.d.rec.tier] ?? 0.4) + 0.35) * boost.hov.f}
          depthWrite={false}
          renderOrder={ORDER_BOOST}
        />
      )}
      {boost.sel && boost.sel.pts.length > 0 && (
        <Line
          segments
          points={boost.sel.pts}
          color={boost.sel.color}
          lineWidth={SEL_W}
          transparent
          opacity={SEL_OP * boost.sel.f}
          depthWrite={false}
          renderOrder={ORDER_BOOST}
        />
      )}

      {/* site markers for point-sited involved projects */}
      {siteBuckets.map((b, i) => (
        <DotCloud
          key={`s${i}`}
          positions={b.positions}
          color={b.color}
          size={SITE_DOT}
          opacity={b.opacity}
          order={ORDER_SITE}
        />
      ))}

      {/* closest-point dots — tier-1 rows are the bullseye stack */}
      {dotBuckets.map((b) => (
        <DotCloud
          key={b.key}
          positions={b.positions}
          color={b.color}
          size={b.size}
          opacity={b.opacity}
          order={ORDER_DOT}
        />
      ))}

      {/* selection/hover pins */}
      {[boost.sel, boost.hov].map((b, i) => {
        if (!b || b.pins.length === 0) return null
        const t1 = b.d.rec.tier === 1
        const sizes = t1
          ? BOOST_BULL
          : { outer: BOOST_OUTER, mid: 0, inner: BOOST_INNER }
        const s = (b.strong ? 1 : HIGHLIGHT_F) * b.f
        return (
          <group key={i}>
            <DotCloud
              positions={b.pins}
              color={b.color}
              size={sizes.outer * (b.strong ? 1 : 0.85)}
              opacity={s}
              order={ORDER_DOT + 1}
            />
            {t1 && (
              <DotCloud
                positions={b.pins}
                color={PALETTE.paper}
                size={sizes.mid * (b.strong ? 1 : 0.85)}
                opacity={s}
                order={ORDER_DOT + 2}
              />
            )}
            <DotCloud
              positions={b.pins}
              color={t1 ? b.color : PALETTE.ink}
              size={sizes.inner * (b.strong ? 1 : 0.85)}
              opacity={s}
              order={ORDER_DOT + 3}
            />
          </group>
        )
      })}
    </group>
  )
}
