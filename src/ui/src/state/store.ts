import { create } from 'zustand'
import type { Tier } from '../lib/palette'
import type { SceneId } from '../lib/projection'

export type { SceneId }

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

  setActiveScene: (scene: SceneId) => void
  selectOverlap: (id: string | null) => void
  toggleTier: (tier: Tier) => void
  setTimelineOnly: (value: boolean) => void
  setHoveredProject: (id: string | null) => void
  setFocusTarget: (target: [number, number] | null) => void
  setPanelOpen: (open: boolean) => void
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

  setActiveScene: (scene) => set({ activeScene: scene }),
  selectOverlap: (id) => set({ selectedOverlapId: id }),
  toggleTier: (tier) =>
    set((s) => ({
      visibleTiers: { ...s.visibleTiers, [tier]: !s.visibleTiers[tier] },
    })),
  setTimelineOnly: (value) => set({ timelineOnly: value }),
  setHoveredProject: (id) => set({ hoveredProjectId: id }),
  setFocusTarget: (target) => set({ focusTarget: target }),
  setPanelOpen: (open) => set({ panelOpen: open }),
}))
