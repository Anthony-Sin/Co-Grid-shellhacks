import { useAppStore } from '../state/store'
import { lonLatToLocal, SCENE_CENTERS, type SceneId } from './projection'

/**
 * Deep-link / headless-capture params, applied once at startup:
 *   ?scene=savannah|augusta   initial corridor scene
 *   ?select=<overlap_id>      pre-select an overlap (FocusRig flies to it)
 *   ?focus=<lon>,<lat>        fly the camera to an arbitrary point
 *   ?panel=0|1                hide/show the opportunities panel
 *   ?tiers=1,2,3,4            restrict visible tiers
 *   ?timeline=0|1             timeline-overlap-only filter
 *
 * Used by scripts/screenshot.sh and handy for sharing specific views.
 */
export function applyUrlParams() {
  const q = new URLSearchParams(window.location.search)
  const s = useAppStore.getState()

  const scene = q.get('scene')
  let activeScene: SceneId = s.activeScene
  if (scene === 'savannah' || scene === 'augusta' || scene === 'state') {
    s.setActiveScene(scene as SceneId)
    activeScene = scene as SceneId  // s is a stale snapshot after set()
  }

  const panel = q.get('panel')
  if (panel === '0' || panel === 'false') s.setPanelOpen(false)
  if (panel === '1' || panel === 'true') s.setPanelOpen(true)

  const timeline = q.get('timeline')
  if (timeline === '0' || timeline === 'false') s.setTimelineOnly(false)
  if (timeline === '1' || timeline === 'true') s.setTimelineOnly(true)

  const tiers = q.get('tiers')
  if (tiers) {
    const wanted = new Set(tiers.split(',').map((t) => Number(t.trim())))
    for (const t of [1, 2, 3, 4] as const) {
      if (s.visibleTiers[t] !== wanted.has(t)) s.toggleTier(t)
    }
  }

  // select BEFORE focus: selectOverlap clears focusTarget by design
  // (stale-target guard), so applying focus after preserves a
  // ?select=X&focus=y deep link instead of silently dropping the fly-to.
  const select = q.get('select')
  if (select) s.selectOverlap(select)

  // project selection is store-exclusive with overlap selection — applying
  // it after `select` means ?project= wins when both are present
  const project = q.get('project')
  if (project) s.selectProject(project)

  const focus = q.get('focus')
  if (focus) {
    const [lon, lat] = focus.split(',').map(Number)
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      const [x, y] = lonLatToLocal(lon, lat, SCENE_CENTERS[activeScene])
      s.setFocusTarget([x, -y])
    }
  }
}
