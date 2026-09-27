import { create } from 'zustand'
import type { Tier } from '../lib/palette'
import type { SceneId } from '../lib/projection'

export type { SceneId }

/** Basemap treatment — 'flat' is the clean web-map look (filled land,
 * blue water, soft green parks, neutral road strokes, no 3D extrusions);
 * 'sketch' keeps the hand-drawn paper city (extruded buildings + ink).
 * The data layer (planned lines, overlap zones) is unaffected — it stays
 * the hero in both. */
export type MapStyle = 'flat' | 'sketch'

/** Map layer toggles — the ViewModes overlay controls which scene
 * layers render. `projects` also gates overlap zones' connectors. */
export interface LayerFlags {
  basemap: boolean
  projects: boolean
  zones: boolean
  labels: boolean
}

/** Year-window filter — overlaps whose shared/adjacent window
 * intersects [start,end] stay visible (list + map). null = no filter. */
export interface YearRange {
  start: number
  end: number
}

/** Context pinned to the agent bar by "ask agent" buttons — rendered as
 * a removable chip above the input and prepended to the outgoing
 * message as a compact `[context: …]` line. `label` is display text
 * (e.g. 'OV-0004 · DESC Jasper⇄SanteeCooper Bluffton'); `id` is the
 * canonical record id when the chip points at one. */
export interface AgentContext {
  kind: 'overlap' | 'project' | 'view'
  id?: string
  label: string
}

interface AppState {
  /** Which corridor scene is being viewed */
  activeScene: SceneId
  /** Currently selected coordination overlap (overlaps.json `overlap_id`) */
  selectedOverlapId: string | null
  /** Currently selected project (projects.geojson `project_id`) — mutually
   * exclusive with selectedOverlapId: the right rail shows ONE detail card */
  selectedProjectId: string | null
  /** Per-tier visibility toggles for map + ranked list */
  visibleTiers: Record<Tier, boolean>
  /** When true, only show overlaps where project timelines intersect */
  timelineOnly: boolean
  /** Project currently hovered on the map (projects.geojson `project_id`) */
  hoveredProjectId: string | null
  /** World-space point the camera should fly to [x, z] meters (null = none) */
  focusTarget: [number, number] | null
  /** Left opportunities panel open/collapsed */
  panelOpen: boolean
  /** Basemap style — flat web map (default) vs 3D sketch city */
  mapStyle: MapStyle
  /** Scene layer visibility (ViewModes overlay) */
  layers: LayerFlags
  /** Year-window filter shared by list + map */
  yearFilter: YearRange | null
  /** Draft text the agent bar should prefill (e.g. "ask about this" buttons) */
  agentPromptDraft: string | null
  /** Pinned chat context for the agent bar (chip above the input).
   *  Draft setters may pass one explicitly; the bar infers one from the
   *  draft text otherwise. Stays pinned until cleared — each submitted
   *  message repeats it as a `[context: …]` prefix. */
  agentContext: AgentContext | null
  /** Overlap hovered in the ranked list — map zones highlight (brushing) */
  hoveredOverlapId: string | null
  /** Utility filter — records involving ANY selected utility pass */
  utilityFilter: string[]
  /** Region-zone dropdown filter ('' = all) — shared by list + map */
  zoneFilter: string
  /** Free-text search (overlap/project id, name, utility) — shared by
   *  list + map so typing in the panel hides non-matching geometry too */
  searchText: string

  setActiveScene: (scene: SceneId) => void
  selectOverlap: (id: string | null) => void
  selectProject: (id: string | null) => void
  toggleTier: (tier: Tier) => void
  setTimelineOnly: (value: boolean) => void
  setHoveredProject: (id: string | null) => void
  setFocusTarget: (target: [number, number] | null) => void
  setPanelOpen: (open: boolean) => void
  setMapStyle: (style: MapStyle) => void
  toggleLayer: (layer: keyof LayerFlags) => void
  setYearFilter: (range: YearRange | null) => void
  setAgentPromptDraft: (text: string | null, context?: AgentContext | null) => void
  setAgentContext: (ctx: AgentContext | null) => void
  clearAgentContext: () => void
  setHoveredOverlap: (id: string | null) => void
  toggleUtilityFilter: (utility: string) => void
  clearUtilityFilter: () => void
  /** Bulk-set the utility filter (e.g. agent map_focus) — replaces, not toggles */
  setUtilityFilter: (utilities: string[]) => void
  /** Bulk-set tier visibility — replaces the whole record */
  setVisibleTiers: (tiers: Record<Tier, boolean>) => void
  setZoneFilter: (zone: string) => void
  setSearchText: (q: string) => void
}

/** Hover write-through + once-per-frame notify.
 *
 *  Pointer over/out bursts across dense hit spheres / zone catch-planes
 *  (plus list-row brushing) used to commit a store update per event —
 *  each commit re-rendered OverlapPanel's ~150 rows, re-sorted ~334 chip
 *  labels, and fired DemandInvalidator for a full WebGL frame. Now the
 *  field is mutated on the live state object immediately — so same-task
 *  `getState().hovered*Id` ownership guards (ProjectMarkers/ZonePolygon
 *  out-handlers) still read the LATEST owner and out-of-order out events
 *  can't clobber a pending hover — while subscribers are notified once
 *  per animation frame via an empty setState re-emit (zustand selectors
 *  diff their slice, so each consumer re-renders at most once per frame).
 *  Latest value wins; null flows identically. Primitive fields only —
 *  never do this for object/array slices (identity equality would miss
 *  an in-place change). */
const _hoverRaf = { id: 0 }
const _schedule: (cb: () => void) => number =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(cb, 16) as unknown as number

function makeCoalescedHover(
  key: 'hoveredProjectId' | 'hoveredOverlapId',
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
): (id: string | null) => void {
  return (id) => {
    const st = get()
    if (st[key] === id) return
    Object.assign(st, { [key]: id })
    if (_hoverRaf.id) return // a flush is already coming — latest wins
    _hoverRaf.id = _schedule(() => {
      _hoverRaf.id = 0
      set({}) // re-emit: listeners diff slices against last-notified values
    })
  }
}

export const useAppStore = create<AppState>()((set, get) => {
  const setHoveredProject = makeCoalescedHover('hoveredProjectId', get, set)
  const setHoveredOverlap = makeCoalescedHover('hoveredOverlapId', get, set)
  return {
  // one-scene build: the statewide GA+SC view is the whole map — corridor
  // deep links (scene=savannah|augusta) resolve here via urlParams
  activeScene: 'state',
  selectedOverlapId: null,
  selectedProjectId: null,
  visibleTiers: { 1: true, 2: true, 3: true, 4: true },
  // Timeline overlap is the mandatory secondary signal (AGENTS.md §8) — on by default
  timelineOnly: true,
  hoveredProjectId: null,
  focusTarget: null,
  panelOpen: true,
  // flat is the default read — the state sheet + utility-colored data
  // layer carry the story; sketch is opt-in for the hand-drawn 3D look
  mapStyle: 'flat',
  // zones default OFF — the circles are opt-in via "map view »" (a selected
  // overlap still renders its own zone even with the layer off)
  layers: { basemap: true, projects: true, zones: false, labels: true },
  yearFilter: null,
  agentPromptDraft: null,
  agentContext: null,
  hoveredOverlapId: null,
  utilityFilter: [],
  zoneFilter: '',
  searchText: '',

  setActiveScene: (scene) => set({ activeScene: scene }),
  // clearing focusTarget here: a deep-link ?focus= target is a one-shot —
  // any explicit selection/deselection releases it, otherwise the stale
  // target would override every later fly-to forever. Selections are
  // exclusive — picking an overlap clears any picked project (and vv).
  selectOverlap: (id) =>
    set({ selectedOverlapId: id, selectedProjectId: null, focusTarget: null }),
  selectProject: (id) =>
    set({ selectedProjectId: id, selectedOverlapId: null, focusTarget: null }),
  toggleTier: (tier) =>
    set((s) => ({
      visibleTiers: { ...s.visibleTiers, [tier]: !s.visibleTiers[tier] },
    })),
  setTimelineOnly: (value) => set({ timelineOnly: value }),
  // write-through coalesced — see makeCoalescedHover above
  setHoveredProject,
  setFocusTarget: (target) => set({ focusTarget: target }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  setMapStyle: (style) => set({ mapStyle: style }),
  toggleLayer: (layer) =>
    set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
  setYearFilter: (range) => set({ yearFilter: range }),
  // a new draft REPLACES any pinned context — the consuming bar re-pins
  // the explicit context (or one inferred from the draft text)
  setAgentPromptDraft: (text, context = null) =>
    set({ agentPromptDraft: text, agentContext: context }),
  setAgentContext: (ctx) => set({ agentContext: ctx }),
  clearAgentContext: () => set({ agentContext: null }),
  setHoveredOverlap,
  toggleUtilityFilter: (utility) =>
    set((s) => ({
      utilityFilter: s.utilityFilter.includes(utility)
        ? s.utilityFilter.filter((u) => u !== utility)
        : [...s.utilityFilter, utility],
    })),
  clearUtilityFilter: () => set({ utilityFilter: [] }),
  setUtilityFilter: (utilities) => set({ utilityFilter: utilities }),
  setVisibleTiers: (tiers) => set({ visibleTiers: tiers }),
  setZoneFilter: (zone) => set({ zoneFilter: zone }),
  setSearchText: (q) => set({ searchText: q }),
  }
})
