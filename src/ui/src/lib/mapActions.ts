import type { AgentTrace, FeatureCollection, ProjectProps } from './api'
import { lonLatToLocal, SCENE_CENTERS } from './projection'
import { selectOverlapInScene } from './selectOverlap'
import { useAppStore } from '../state/store'
import { peekApiData } from '../ui/hooks/useApiData'

/**
 * mapActions — apply the backend `map_focus` tool's `ui_action` to the
 * map store. The tool validates ids server-side (unknown ids return an
 * honest error and no ui_action); here we only execute.
 *
 * Where the action comes from: the SSE `tool` event carries the full
 * trace entry {tool, args, preview} — `preview` is the tool result JSON
 * (truncated ~600 chars upstream; map_focus results stay well under
 * that). If a preview is absent/unparseable we fall back to the raw
 * call args — the model's stated intent — which degrades gracefully:
 * a bad id just selects nothing (the detail card says "not in dataset").
 */

/** One map mutation the `map_focus` tool asks the UI to apply. */
export interface MapUiAction {
  select_overlap?: string | null
  select_project?: string | null
  utility_filter?: string[] | null
  tiers?: number[] | null
  clear?: boolean
}

/** map_focus call args -> ui_action form (fallback path only). */
function actionFromArgs(args: Record<string, unknown> | undefined): MapUiAction | null {
  if (!args) return null
  const a: MapUiAction = {}
  if (typeof args.overlap_id === 'string' && args.overlap_id) a.select_overlap = args.overlap_id
  if (typeof args.project_id === 'string' && args.project_id) a.select_project = args.project_id
  if (typeof args.utility === 'string' && args.utility) a.utility_filter = [args.utility]
  if (Array.isArray(args.tiers))
    a.tiers = args.tiers.filter((t): t is number => typeof t === 'number')
  if (args.clear === true) a.clear = true
  return Object.keys(a).length ? a : null
}

/** Extract the ui_action from a map_focus trace entry, or null when this
 * entry isn't a map action (or the tool reported a validation error). */
export function mapActionFromTrace(t: AgentTrace): MapUiAction | null {
  if (t.tool !== 'map_focus') return null
  if (t.preview) {
    try {
      const a = (JSON.parse(t.preview) as { ui_action?: MapUiAction }).ui_action
      // a result that parsed but carries no ui_action = validation error —
      // do NOT fall back to args (the server already refused them)
      return a && typeof a === 'object' ? a : null
    } catch {
      // truncated preview — fall through to the raw call args
    }
  }
  return actionFromArgs(t.args)
}

/** Vertex-average lon/lat of a GeoJSON geometry — a camera target only,
 * not a measurement. null when the feature carries no geometry. */
function centroidLonLat(coords: unknown): [number, number] | null {
  let sx = 0
  let sy = 0
  let n = 0
  const walk = (c: unknown) => {
    if (Array.isArray(c)) {
      if (c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
        sx += c[0]
        sy += c[1]
        n++
      } else {
        c.forEach(walk)
      }
    }
  }
  walk(coords)
  return n ? [sx / n, sy / n] : null
}

/** Fly the camera to a project's centroid via the one-shot focusTarget —
 * selectProject clears focusTarget, so this must run AFTER selecting. */
function flyToProject(pid: string): void {
  const feats = peekApiData<FeatureCollection<ProjectProps>>('projects')?.features
  const c = centroidLonLat(
    feats?.find((f) => f.properties.project_id === pid)?.geometry?.coordinates,
  )
  if (!c) return
  const s = useAppStore.getState()
  const [x, y] = lonLatToLocal(c[0], c[1], SCENE_CENTERS[s.activeScene])
  s.setFocusTarget([x, -y]) // focusTarget is [x, z]; +y north renders as -z
}

/** Apply one ui_action to the map store. `clear` resets selection +
 * filters to defaults; selection runs last because select_* clears
 * focusTarget (the fly-to must land after the select). */
export function applyMapAction(a: MapUiAction): void {
  const s = useAppStore.getState()
  if (a.clear) {
    s.selectOverlap(null) // clears both selections + focusTarget
    s.clearUtilityFilter()
    s.setVisibleTiers({ 1: true, 2: true, 3: true, 4: true })
    s.setYearFilter(null)
    s.setTimelineOnly(true)
  }
  if (a.tiers?.length) {
    const on = new Set(a.tiers)
    s.setVisibleTiers({ 1: on.has(1), 2: on.has(2), 3: on.has(3), 4: on.has(4) })
  }
  if (a.utility_filter?.length) s.setUtilityFilter(a.utility_filter)
  if (a.select_overlap) {
    selectOverlapInScene(a.select_overlap)
  } else if (a.select_project) {
    s.selectProject(a.select_project)
    flyToProject(a.select_project)
  }
}
