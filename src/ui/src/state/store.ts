import { create } from 'zustand'
import type { Tier } from '../lib/palette'
import type { SceneId } from '../lib/projection'

export type { SceneId }

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
  toggleTier: (tier: Tier) => void
  setTimelineOnly: (value: boolean) => void
  setHoveredProject: (id: string | null) => void
  setFocusTarget: (target: [number, number] | null) => void
  setPanelOpen: (open: boolean) => void
  toggleLayer: (layer: keyof LayerFlags) => void
  setYearFilter: (range: YearRange | null) => void
  setAgentPromptDraft: (text: string | null) => void
  setHoveredOverlap: (id: string | null) => void
  toggleUtilityFilter: (utility: string) => void
  clearUtilityFilter: () => void
}

export const useAppStore = create<AppState>()((set) => ({
  activeScene: 'savannah',
  selectedOverlapId: null,
  visibleTiers: { 1: true, 2: true, 3: true, 4: true },
  // Timeline overlap is the mandatory secondary signal (AGENTS.md §8) — on by default
  timelineOnly: true,
  hoveredProjectId: null,
  focusTarget: null,
  panelOpen: true,
  layers: { basemap: true, projects: true, zones: true, labels: true },
  yearFilter: null,
  agentPromptDraft: null,
  hoveredOverlapId: null,
  utilityFilter: [],

  setActiveScene: (scene) => set({ activeScene: scene }),
  // clearing focusTarget here: a deep-link ?focus= target is a one-shot —
  // any explicit selection/deselection releases it, otherwise the stale
  // target would override every later fly-to forever
  selectOverlap: (id) => set({ selectedOverlapId: id, focusTarget: null }),
  toggleTier: (tier) =>
    set((s) => ({
      visibleTiers: { ...s.visibleTiers, [tier]: !s.visibleTiers[tier] },
    })),
  setTimelineOnly: (value) => set({ timelineOnly: value }),
  setHoveredProject: (id) => set({ hoveredProjectId: id }),
  setFocusTarget: (target) => set({ focusTarget: target }),
  setPanelOpen: (open) => set({ panelOpen: open }),
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
