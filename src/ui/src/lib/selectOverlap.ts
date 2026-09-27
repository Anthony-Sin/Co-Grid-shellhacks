import { useAppStore } from '../state/store'
import { sceneForZone } from './projection'
import { peekApiData } from '../ui/hooks/useApiData'
import type { OverlapsResponse } from './api'

/**
 * Select an overlap AND jump to the scene that contains it. The zone→scene
 * mapping mirrors backend `projection.scene_for_zone`, so clicking a record
 * that lives in a different corridor can't leave the camera staring at empty
 * space. When the caller doesn't have the record's zone, it's resolved from
 * the shared overlaps cache (already-loaded list — never issues a fetch;
 * if the cache is cold we just keep the current scene).
 */
export function selectOverlapInScene(
  id: string | null,
  zone?: string | null,
): void {
  const s = useAppStore.getState()
  if (id) {
    let z = zone
    if (z === undefined) {
      z =
        peekApiData<OverlapsResponse>('overlaps')?.overlaps.find(
          (o) => o.overlap_id === id,
        )?.zone ?? null
    }
    if (z) {
      const scene = sceneForZone(z)
      if (scene !== s.activeScene) s.setActiveScene(scene)
    }
  }
  s.selectOverlap(id)
}
