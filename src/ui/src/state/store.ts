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
  /** Overlap hovered in the ranked list — map zones highlight (brushing) */
  hoveredOverlapId: string | null
  /** Utility filter — records involving ANY selected utility pass */
  utilityFilter: string[]

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
  setAgentPromptDraft: (text: string | null) => void
  setHoveredOverlap: (id: string | null) => void
  toggleUtilityFilter: (utility: string) => void
  clearUtilityFilter: () => void
}

export const useAppStore = create<AppState>()((set) => ({
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
  hoveredOverlapId: null,
  utilityFilter: [],

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
  setHoveredProject: (id) => set({ hoveredProjectId: id }),
  setFocusTarget: (target) => set({ focusTarget: target }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  setMapStyle: (style) => set({ mapStyle: style }),
  toggleLayer: (layer) =>
    set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
  setYearFilter: (range) => set({ yearFilter: range }),
  setAgentPromptDraft: (text) => set({ agentPromptDraft: text }),
  setHoveredOverlap: (id) => set({ hoveredOverlapId: id }),
  toggleUtilityFilter: (utility) =>
    set((s) => ({
      utilityFilter: s.utilityFilter.includes(utility)
        ? s.utilityFilter.filter((u) => u !== utility)
        : [...s.utilityFilter, utility],
    })),
  clearUtilityFilter: () => set({ utilityFilter: [] }),
}))
