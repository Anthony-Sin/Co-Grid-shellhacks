/**
 * OverlapZones — the coordination layer: color-coded hatched zones +
 * connector arcs, styled like axonometric planning-map markup.
 *
 * Data: fetched ONCE per session (module-cached promise — the component is
 * remounted per scene via `key` in CityCanvas, so a module cache avoids
 * refetching). Overlaps come from /api/overlaps, project geometries from
 * /api/projects for scene relevance + chip labels. On failure the layer
 * renders nothing and warns once — never fakes content (AGENTS.md §7).
 *
 * Filters (zustand store):
 *   visibleTiers[tier] = false → record not rendered at all
 *   timelineOnly && !timeline_overlap → rendered as thin dashed outline +
 *     faint dashed arc (flagged, not erased)
 *   selectedOverlapId → that zone raises/pops full-opacity + beacon column,
 *     everything else dims to ~40%
 *
 * Top-3 scored visible records also get a floating ZoneLabel chip.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { api, type OverlapRecord } from '../../lib/api'
import { deduped } from '../../ui/hooks/useApiData'
import { TIER_COLORS } from '../../lib/palette'
import { SCENE_CENTERS } from '../../lib/projection'
import { STATE_RELEVANCE_M } from './zoneData'
import { useAppStore } from '../../state/store'
import { ConnectorLink } from './ConnectorLink'
import { buildZoneDatum, type ProjectsById, type ZoneDatum } from './zoneData'
import { ZoneLabel } from './ZoneLabel'
import { ZonePolygon } from './ZonePolygon'

interface LoadedData {
  overlaps: OverlapRecord[]
  projectsById: ProjectsById
}

/** Fetch cache — shares the useApiData request cache, so panel/detail/
 * zones all ride ONE /api/overlaps + /api/projects fetch per session.
 * deduped() evicts rejections, so a late-starting backend still recovers. */
let warnedOnce = false

function loadData(): Promise<LoadedData> {
  return Promise.all([
    deduped('overlaps', api.overlaps),
    deduped('projects', api.projects),
  ]).then(([ov, pr]) => ({
    overlaps: ov.overlaps ?? [],
    projectsById: new Map(
      pr.features.map((f) => [f.properties.project_id, f]),
    ),
  }))
}

/** How many ranked label chips to float above the map. */
const TOP_LABEL_COUNT = 3
/**
 * Max zones drawn at once — ~160 tier-4 capsules at once would saturate the
 * map into a solid wash (all records remain listed/selectable in the panel;
 * a selection is always rendered even when outside the top-N).
 */
const MAX_RENDERED = 40
/** Selected-zone beacon column dimensions. */
const BEACON_RADIUS = 200
const BEACON_HEIGHT = 300

export function OverlapZones() {
  const activeScene = useAppStore((s) => s.activeScene)
  const visibleTiers = useAppStore((s) => s.visibleTiers)
  const timelineOnly = useAppStore((s) => s.timelineOnly)
  const selectedOverlapId = useAppStore((s) => s.selectedOverlapId)

  const [data, setData] = useState<LoadedData | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    loadData()
      .then((d) => {
        if (alive) setData(d)
      })
      .catch((e: unknown) => {
        if (!warnedOnce) {
          warnedOnce = true
          console.warn('[OverlapZones] overlap data unavailable — layer disabled:', e)
        }
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  /** Scene-local datums for overlaps relevant to this scene (~40km rule;
   * the statewide scene covers the whole GA+SC envelope). */
  const datums = useMemo(() => {
    if (!data) return []
    const center = SCENE_CENTERS[activeScene]
    const relevanceM = activeScene === 'state' ? STATE_RELEVANCE_M : 40_000
    return data.overlaps
      .map((rec) => buildZoneDatum(rec, center, data.projectsById, relevanceM))
      .filter((d) => d.relevant)
  }, [data, activeScene])

  /** Tier filter fully hides a record; timeline filter only restyles it.
   *  Capped at MAX_RENDERED by score — the selected record always survives. */
  const rendered = useMemo(() => {
    const eligible = datums.filter((d) => visibleTiers[d.rec.tier])
    if (eligible.length <= MAX_RENDERED) return eligible
    const top = eligible
      .slice()
      .sort((a, b) => b.rec.score - a.rec.score)
      .slice(0, MAX_RENDERED)
    if (
      selectedOverlapId &&
      !top.some((d) => d.rec.overlap_id === selectedOverlapId)
    ) {
      const sel = eligible.find((d) => d.rec.overlap_id === selectedOverlapId)
      if (sel) top.push(sel)
    }
    return top
  }, [datums, visibleTiers, selectedOverlapId])

  /** Top-3 scored records eligible for floating labels (timeline-honest). */
  const labelIds = useMemo(() => {
    const eligible = rendered
      .filter((d) => d.rec.timeline_overlap || !timelineOnly)
      .sort((a, b) => b.rec.score - a.rec.score)
      .slice(0, TOP_LABEL_COUNT)
    return new Set(eligible.map((d) => d.rec.overlap_id))
  }, [rendered, timelineOnly])

  /** The selected record — only "pops" when it is actually rendered here. */
  const selectedDatum = useMemo(
    () => rendered.find((d) => d.rec.overlap_id === selectedOverlapId) ?? null,
    [rendered, selectedOverlapId],
  )

  if (failed || !data) return null

  return (
    <group>
      {rendered.map((d) => {
        const selected = d.rec.overlap_id === selectedOverlapId
        const dimmed = selectedDatum !== null && !selected
        const outlineOnly = timelineOnly && !d.rec.timeline_overlap
        return (
          <Fragment key={d.rec.overlap_id}>
            <ZonePolygon
              datum={d}
              dimmed={dimmed}
              selected={selected}
              outlineOnly={outlineOnly}
            />
            <ConnectorLink
              datum={d}
              dimmed={dimmed}
              selected={selected}
              faint={outlineOnly}
            />
            {labelIds.has(d.rec.overlap_id) && <ZoneLabel datum={d} />}
          </Fragment>
        )
      })}

      {/* soft light column marking the selected zone */}
      {selectedDatum && <SelectionBeacon datum={selectedDatum} />}
    </group>
  )
}

/** Translucent tier-colored beacon column at the selected zone centroid. */
function SelectionBeacon({ datum }: { datum: ZoneDatum }) {
  return (
    <mesh
      position={[datum.centroid[0], BEACON_HEIGHT / 2, -datum.centroid[1]]}
      renderOrder={9}
    >
      <cylinderGeometry args={[BEACON_RADIUS, BEACON_RADIUS, BEACON_HEIGHT, 48, 1, true]} />
      <meshBasicMaterial
        color={TIER_COLORS[datum.rec.tier] ?? '#888888'}
        transparent
        opacity={0.15}
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}
