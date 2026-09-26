import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { api, type OverlapRecord } from '../lib/api'
import { deduped } from '../ui/hooks/useApiData'
import { lonLatToLocal, SCENE_CENTERS } from '../lib/projection'
import { useAppStore } from '../state/store'

/**
 * Selection fly-to: when `selectedOverlapId` (or an explicit `focusTarget`)
 * changes, smoothly glide the orthographic camera toward the overlap's
 * projected midpoint and ease the zoom in. Respects live MapControls.
 */
export function FocusRig() {
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3
    update?: () => void
  } | null
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)
  const selectedOverlapId = useAppStore((s) => s.selectedOverlapId)
  const focusTarget = useAppStore((s) => s.focusTarget)
  const activeScene = useAppStore((s) => s.activeScene)

  const [overlaps, setOverlaps] = useState<OverlapRecord[] | null>(null)
  const goal = useRef<{ target: THREE.Vector3; zoom: number } | null>(null)

  // Warm the overlaps cache once (state — the goal below may depend on it).
  // Shares the session-wide request cache with the panel/zones layers.
  useEffect(() => {
    let alive = true
    deduped('overlaps', api.overlaps)
      .then((d) => {
        if (alive) setOverlaps(d.overlaps)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // Resolve the fly-to goal whenever selection/scene/data changes.
  useEffect(() => {
    if (focusTarget) {
      goal.current = { target: new THREE.Vector3(focusTarget[0], 0, focusTarget[1]), zoom: 0.35 }
      invalidate()
      return
    }
    if (!selectedOverlapId || !overlaps) {
      goal.current = null  // deselect mid-flight cancels the flight
      return
    }
    const rec = overlaps.find((o) => o.overlap_id === selectedOverlapId)
    if (!rec) return
    const [x, y] = lonLatToLocal(rec.midpoint[0], rec.midpoint[1], SCENE_CENTERS[activeScene])
    // Closer tiers deserve a tighter zoom — framed so the whole zone reads.
    const zoom = rec.tier <= 2 ? 0.32 : rec.tier === 3 ? 0.2 : 0.1
    goal.current = { target: new THREE.Vector3(x, 0, -y), zoom }
    invalidate() // kick off the flight under demand-mode rendering
  }, [selectedOverlapId, focusTarget, activeScene, overlaps, invalidate])

  useFrame((_, dt) => {
    if (!goal.current || !controls) return
    const t = 1 - Math.exp(-4.2 * dt) // critically-damped-ish ease
    controls.target.lerp(goal.current.target, t)
    const ortho = camera as THREE.OrthographicCamera
    if (ortho.isOrthographicCamera) {
      ortho.zoom += (goal.current.zoom - ortho.zoom) * t
      ortho.updateProjectionMatrix()
    }
    controls.update?.()
    if (controls.target.distanceTo(goal.current.target) < 1) {
      goal.current = null
    } else {
      invalidate() // keep the flight at full speed until arrival
    }
  })

  return null
}
