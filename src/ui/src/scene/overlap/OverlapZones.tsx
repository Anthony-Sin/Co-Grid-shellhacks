/**
 * OverlapZones — the coordination layer. Two zoom regimes:
 *
 *  • overview (zoom < ~0.01, e.g. the whole GA+SC sheet): NO zone
 *    circles — a 40km hatched capsule at statewide scale floods the map
 *    and reads as wrong. Instead the overlap is line-centric (see
 *    OverlapLines): each record's two involved planned lines carry a
 *    tier-colored glow halo, the closest points get tier-colored dots
 *    (tier-1 touching gets a bullseye), and only featured records draw
 *    the connector arc + `T{n} · A⇄B · km` pill (top-N by score +
 *    selected + hovered — capped so pills never swarm).
 *  • corridor (zoom ≥ ~0.01): zones render as SOFT overlays — translucent
 *    tier fill + thin ink outline. The signature diagonal hatch is kept
 *    ONLY for the selected zone (the focus affordance).
 *
 * Data: fetched ONCE per session (module-cached promise — the component is
 * remounted per scene via `key` in CityCanvas, so a module cache avoids
 * refetching). Overlaps come from /api/overlaps, project geometries from
 * /api/projects for scene relevance + chip labels. On failure the layer
 * renders nothing and warns once — never fakes content (AGENTS.md §7).
 *
 * Filters (zustand store — shared with the ranked list via passesMapFilters):
 *   visibleTiers[tier] = false → record not rendered at all — the tier's
 *     glow, dots, zone, arc and pill all vanish (the involved line reverts
 *     to a plain planned line, so toggling reads instantly)
 *   utilityFilter / yearFilter → hard filters, same predicate as the list;
 *     a side whose project fails passesProjectFilters draws no glow (no
 *     phantom lines over hidden wires)
 *   timelineOnly && !timeline_overlap → zone = thin dashed outline,
 *     glow/dots faint (flagged, not erased)
 *   selectedOverlapId → glow/marker break out brighter + beacon column,
 *     everything else dims to ~40% — BUT a selected record that fails the
 *     hard filters still doesn't draw (honest absence; the panel's
 *     "outside current filters" banner is the disclosure, not the map)
 *   hoveredOverlapId → brushed highlight (~70% of selected) from list or map
 *   layers.labels → gates ZoneLabel chips + connector pill chips
 *   layers.projects → gates connectors AND the line glows (a glow over a
 *     hidden wire would be a phantom line); closest-point dots are record
 *     markup and stay
 *
 * Top-3 scored visible records also get a floating ZoneLabel chip when
 * the projects layer is off (the pill fallback).
 */
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { api, type OverlapRecord } from '../../lib/api'
import { deduped } from '../../ui/hooks/useApiData'
import { passesMapFilters, passesProjectFilters } from '../../lib/overlapFilters'
import { PALETTE, SELECT_COLOR, TIER_COLORS } from '../../lib/palette'
import { SCENE_CENTERS } from '../../lib/projection'
import { useZoomAtLeast } from '../city/cityUtils'
import { STATE_RELEVANCE_M } from './zoneData'
import { useAppStore } from '../../state/store'
import { ConnectorLink } from './ConnectorLink'
import { OverlapLines } from './OverlapLines'
import { OverlapStackPopup } from './OverlapStackPopup'
import { buildStacks, STACK_RADIUS_FAR_M, STACK_RADIUS_NEAR_M, type OverlapStack } from './stackData'
import { buildProjectGeoms, buildZoneDatum, type ProjectsById, type ZoneDatum } from './zoneData'
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
 * Max records drawn at once — glows/dots are merged buckets so hundreds
 * of records stay cheap; the score-ordered cap is a safety rail for the
 * per-record zone polygons at corridor zoom. All records remain listed/
 * selectable in the panel; a selection is always rendered even when
 * outside the top-N.
 */
const MAX_RENDERED = 200
/** Connector arc+pill cap — selected/hovered records always feature on
 *  top of the best-scored N (the pill is an Html root each; a swarm of
 *  them was both expensive and unreadable at statewide zoom). At
 *  statewide zoom the stack chips are the click target, so fewer loose
 *  pills; corridor zoom gets the full dozen. */
const PILL_CAP_NEAR = 12
const PILL_CAP_FAR = 8
/** Ortho zoom where soft zone overlays fade in — corridor-scale reading
 *  starts ~0.01 (state overview sits at 0.0022). Hysteresis below. */
const ZONE_ZOOM = 0.01
/** Selected-zone beacon column dimensions. */
const BEACON_RADIUS = 200
const BEACON_HEIGHT = 300

export function OverlapZones() {
  const activeScene = useAppStore((s) => s.activeScene)
  const visibleTiers = useAppStore((s) => s.visibleTiers)
  const timelineOnly = useAppStore((s) => s.timelineOnly)
  const selectedOverlapId = useAppStore((s) => s.selectedOverlapId)
  const hoveredOverlapId = useAppStore((s) => s.hoveredOverlapId)
  const utilityFilter = useAppStore((s) => s.utilityFilter)
  const yearFilter = useAppStore((s) => s.yearFilter)
  const zoneFilter = useAppStore((s) => s.zoneFilter)
  const searchText = useAppStore((s) => s.searchText)
  const showLabels = useAppStore((s) => s.layers.labels)
  // layers.projects gates connectors AND line glows (store contract) —
  // both reference project geometry that isn't drawn when the layer is off
  const showProjects = useAppStore((s) => s.layers.projects)
  // zones layer is opt-in (default off): when off, only the explicitly
  // selected record renders — the map stays clean but a click still
  // answers "where is this overlap?"
  const zonesOn = useAppStore((s) => s.layers.zones)

  // Zone polygons only earn their keep at corridor zoom — below this the
  // record renders as glow+dots (OverlapLines) with no circles.
  const corridorZoom = useZoomAtLeast(ZONE_ZOOM, 0.7)

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

  // Don't leave a stale brush behind when the layer remounts per scene
  // (mirrors ProjectMarkers' hoveredProjectId cleanup).
  useEffect(
    () => () => useAppStore.getState().setHoveredOverlap(null),
    [],
  )

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

  /** Projected wire/site geometry per project — shared by every record
   *  that touches it, computed once per scene. */
  const geomById = useMemo(
    () => (data ? buildProjectGeoms(data.projectsById, SCENE_CENTERS[activeScene]) : null),
    [data, activeScene],
  )

  /** The panel's project predicate per project_id — a project hidden by
   *  the utility/zone/year/search filters draws no glow (honest absence,
   *  same rule the connector arcs already obey). */
  const projectOk = useMemo(() => {
    if (!data) return null
    const m = new Map<string, boolean>()
    for (const [id, f] of data.projectsById) {
      const p = f.properties
      m.set(
        id,
        passesProjectFilters(
          {
            id,
            name: p?.name ?? '',
            utility: p?.utility ?? '',
            startYear: p?.start_year ?? null,
            endYear: p?.end_year ?? null,
            zones: p?.zones ?? [],
          },
          { utilityFilter, yearRange: yearFilter, zone: zoneFilter, search: searchText },
        ),
      )
    }
    return m
  }, [data, utilityFilter, yearFilter, zoneFilter, searchText])

  /** Hard filters (tier/utility/year — same predicate as the ranked list)
   *  fully hide a record; the timeline filter only restyles it. The gate
   *  runs BEFORE the zones-off selection path and the top-N cap alike: a
   *  filtered-out record never draws, selected or not (honest absence —
   *  the panel surfaces "outside current filters" with a show-anyway
   *  reveal, so the map can stay strict). Render order is always
   *  score-desc so the best opportunities draw first under the cap.
   *  With the zones layer off only the selected record renders at all. */
  const rendered = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    const eligible = datums.filter((d) => {
      if (
        !passesMapFilters(d.rec, {
          visibleTiers, zone: zoneFilter, utilityFilter, yearRange: yearFilter,
        })
      )
        return false
      // same haystack as the panel's search index — overlap id, both
      // project ids + names, utilities — so list row ↔ zone stay in step
      if (q && data) {
        const a = data.projectsById.get(d.rec.project_a)?.properties?.name ?? ''
        const b = data.projectsById.get(d.rec.project_b)?.properties?.name ?? ''
        const hay = [
          d.rec.overlap_id, d.rec.project_a, d.rec.project_b,
          a, b, ...(d.rec.utilities ?? []),
        ].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    if (!zonesOn) {
      return eligible.filter((d) => d.rec.overlap_id === selectedOverlapId)
    }
    eligible.sort((a, b) => b.rec.score - a.rec.score)
    const top = eligible.slice(0, MAX_RENDERED)
    // a selected (or list-hovered) record past the cap still renders —
    // the pill/beacon must answer for it
    for (const id of [selectedOverlapId, hoveredOverlapId]) {
      if (id && !top.some((d) => d.rec.overlap_id === id)) {
        const extra = eligible.find((d) => d.rec.overlap_id === id)
        if (extra) top.push(extra)
      }
    }
    if (import.meta.env.DEV) {
      if (eligible.length <= MAX_RENDERED) {
        console.debug(`[OverlapZones] rendering ${eligible.length} of ${datums.length} scene-relevant overlaps`)
      } else {
        console.debug(`[OverlapZones] rendering ${top.length} of ${eligible.length} filtered overlaps (${datums.length} scene-relevant) — capped at ${MAX_RENDERED}`)
      }
    }
    return top
  }, [datums, zonesOn, visibleTiers, utilityFilter, yearFilter, zoneFilter, searchText, selectedOverlapId, hoveredOverlapId, data])

  /** Coincident featured records collapse into one `N overlaps` stack
   *  chip + popup list instead of pills fighting for the same pixel.
   *  Radius follows zoom — at statewide scale ~24km of world still reads
   *  as the same screen spot; zoomed in it tightens to genuinely
   *  coincident (2.5km). */
  const stackZoomedIn = useZoomAtLeast(0.05, 0.7)
  const stacks = useMemo(
    () => buildStacks(rendered, stackZoomedIn ? STACK_RADIUS_NEAR_M : STACK_RADIUS_FAR_M),
    [rendered, stackZoomedIn],
  )

  /** Featured records draw the connector arc + `T{n} · A⇄B · km` pill:
   *  the best-scored PILL_CAP (timeline-honest) plus selected + hovered. */
  const pillCap = stackZoomedIn ? PILL_CAP_NEAR : PILL_CAP_FAR
  const featured = useMemo(() => {
    const ids = new Set<string>()
    let n = 0
    for (const d of rendered) {
      if (n >= pillCap) break
      if (timelineOnly && !d.rec.timeline_overlap) continue
      ids.add(d.rec.overlap_id)
      n++
    }
    for (const id of [selectedOverlapId, hoveredOverlapId]) {
      if (id && rendered.some((d) => d.rec.overlap_id === id)) ids.add(id)
    }
    return ids
  }, [rendered, timelineOnly, selectedOverlapId, hoveredOverlapId, pillCap])

  const stackById = useMemo(() => {
    const m = new Map<string, OverlapStack>()
    for (const s of stacks) for (const d of s.members) m.set(d.rec.overlap_id, s)
    return m
  }, [stacks])
  const [openStackKey, setOpenStackKey] = useState<string | null>(null)
  const openStack = openStackKey ? stacks.find((s) => s.key === openStackKey) ?? null : null
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenStackKey(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  /* drei <Html> quirk under frameloop="demand": pills mounted in the same
   * commit that first reveals the layer never reach the DOM (their portal
   * ref isn't attached in time) — a second commit fixes them. Nudge one
   * re-render once records first render so the featured pills exist. */
  const [, nudge] = useState(0)
  useEffect(() => {
    if (rendered.length > 0) nudge((n) => (n === 0 ? 1 : n))
  }, [rendered.length])

  if (failed || !data) return null

  return (
    <group>
      {/* soft zone overlays — corridor zoom only; at statewide overview
          circles would flood the sheet, so the glow layer carries it */}
      {corridorZoom &&
        rendered.map((d) => {
          const selected = d.rec.overlap_id === selectedOverlapId
          return (
            <ZonePolygon
              key={d.rec.overlap_id}
              datum={d}
              dimmed={selectedDatum !== null && !selected}
              selected={selected}
              highlighted={d.rec.overlap_id === hoveredOverlapId}
              outlineOnly={timelineOnly && !d.rec.timeline_overlap}
            />
          )
        })}

      {/* line-centric markup at every zoom: tier glows retracing the
          involved project lines, closest-point dots, tier-1 bullseyes,
          selected/hovered breakouts */}
      <OverlapLines
        datums={rendered}
        geomById={geomById}
        projectOk={projectOk}
        selectedId={selectedOverlapId}
        hoveredId={hoveredOverlapId}
        dimmed={selectedDatum !== null}
        timelineOnly={timelineOnly}
        showLines={showProjects}
      />

      {/* connector arc + pill — featured records only (top-N + selected +
          hovered), so the Html pills never swarm. Members of a stack keep
          their arc but cede the pill to the shared `N overlaps` chip. */}
      {showProjects &&
        rendered.map((d) => {
          if (!featured.has(d.rec.overlap_id)) return null
          const stacked = (stackById.get(d.rec.overlap_id)?.members.length ?? 0) > 1
          const selected = d.rec.overlap_id === selectedOverlapId
          return (
            <ConnectorLink
              key={d.rec.overlap_id}
              datum={d}
              dimmed={selectedDatum !== null && !selected}
              selected={selected}
              highlighted={d.rec.overlap_id === hoveredOverlapId}
              faint={timelineOnly && !d.rec.timeline_overlap}
              showChip={showLabels && !stacked}
            />
          )
        })}

      {/* one chip per coincident stack — opens the member list so the
          user picks deliberately instead of raycast winner-take-all */}
      {showProjects &&
        showLabels &&
        stacks.map((s) => {
          if (s.members.length < 2) return null
          if (!s.members.some((d) => featured.has(d.rec.overlap_id))) return null
          const color = TIER_COLORS[s.bestTier] ?? '#888888'
          return (
            <Html key={`stack-${s.key}`} position={[s.centroid[0], 60, -s.centroid[1]]} center zIndexRange={[90, 0]} wrapperClass="map-pill">
              <button
                type="button"
                onClick={() => setOpenStackKey((k) => (k === s.key ? null : s.key))}
                title={`${s.members.length} filed overlaps share this spot — open the list`}
                style={{
                  padding: '5px 12px',
                  background: PALETTE.chipBg,
                  color: PALETTE.chipText,
                  border: 'none',
                  borderLeft: `4px solid ${color}`,
                  borderRadius: 999,
                  boxShadow: '2px 3px 0 rgba(43,43,43,0.25)',
                  whiteSpace: 'nowrap',
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                {s.members.length} overlaps
              </button>
            </Html>
          )
        })}

      {openStack && <OverlapStackPopup stack={openStack} onClose={() => setOpenStackKey(null)} />}

      {/* ZoneLabel is the fallback chip for when the connector's
          midpoint pill isn't showing (projects layer off) — rendering
          both for the same record stacked two labels on the same
          centroid (QA collision), and the pill now carries the tier. */}
      {showLabels &&
        !showProjects &&
        rendered.map(
          (d) =>
            labelIds.has(d.rec.overlap_id) && (
              <ZoneLabel key={d.rec.overlap_id} datum={d} />
            ),
        )}

      {/* soft light column marking the selected zone */}
      {selectedDatum && <SelectionBeacon datum={selectedDatum} />}
    </group>
  )
}

/** Translucent SELECT_COLOR beacon column at the selected zone centroid. */
function SelectionBeacon({ datum }: { datum: ZoneDatum }) {
  return (
    <mesh
      position={[datum.centroid[0], BEACON_HEIGHT / 2, -datum.centroid[1]]}
      renderOrder={9}
    >
      <cylinderGeometry args={[BEACON_RADIUS, BEACON_RADIUS, BEACON_HEIGHT, 48, 1, true]} />
      <meshBasicMaterial
        color={SELECT_COLOR}
        transparent
        opacity={0.15}
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}
