/**
 * labelOverlay.tsx — screen-space DOM label layer for the map canvas.
 *
 * Replaces per-chip drei <Html>: one absolutely-positioned container div
 * over the canvas, chip positions computed with a single useFrame
 * project() pass and applied via direct style writes. Cheaper than N
 * Html roots (each Html spins up a ReactDOM.createRoot + its own
 * useFrame), and it fixes a real bug: drei's isObjectBehindCamera() marks
 * a chip "hidden" when its anchor crosses the camera plane — with our
 * ortho camera's near=-250km, half the visible map sits BEHIND that
 * plane, so chips vanished mid-pan while their area was still on screen.
 *
 * IMPORTANT: the chip DOM must NOT be returned from this component or
 * built with createPortal — this file renders inside the R3F reconciler,
 * which would try to instantiate <div> as a THREE object. Like drei
 * Html, we spin up a SEPARATE react-dom root on the container and
 * root.render() the chips from a layout effect.
 *
 * Visibility rules are honest screen geometry:
 * - anchors stay eligible while projecting within ±`margin` of NDC
 *   (default 1.2 → chips live while their anchor is within ~1.2× the
 *   viewport, so they pre-mount just before panning into view);
 * - DECLUTTER: candidates are tested in `labels` array order (callers
 *   sort by priority — deterministic: same camera → same chips) and a
 *   chip drops if its measured box overlaps an already-placed chip or the
 *   visible cap `maxVisible` is reached. maxVisible may be a fn of
 *   camera.zoom so street zoom allows more labels than the overview;
 * - an optional `ground` point draws a thin leader line chip→ground,
 *   replacing the old 3D cylinder (kept in sync for free — same pass).
 *
 * Chips never unmount for visibility — `visibility:hidden` only — so a
 * re-pan never waits on a React commit.
 *
 * REUSE CONTRACT (ProjectMarkers + any future label layer): build
 * `OverlayLabel[]` in PRIORITY order (index 0 = most important — it wins
 * declutter ties), pass a `render` fn for the pill DOM, and a
 * `maxVisible` cap or zoom fn. Hit meshes / tooltips stay in the 3D
 * scene — this layer is presentation-only (pointerEvents: none).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as ReactDOM from 'react-dom/client'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { ReactNode } from 'react'
import { PALETTE } from '../lib/palette'
import { useAppStore } from '../state/store'

export interface OverlayLabel {
  /** Stable identity for the separate root, declutter + measurement. */
  key: string
  /** World point the chip CENTERS on (x, y-height, z). */
  anchor: readonly [number, number, number]
  /** Optional world ground point — draws an ink leader line to it. */
  ground?: readonly [number, number, number]
}

/** Centered screen rect in CSS px (x,y = center). */
export interface ScreenBox {
  x: number
  y: number
  w: number
  h: number
}

/** AABB overlap of two centered boxes with `gap` px of breathing room. */
export function boxesOverlap(a: ScreenBox, b: ScreenBox, gap = 0): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.w + b.w + gap * 2 &&
    Math.abs(a.y - b.y) * 2 < a.h + b.h + gap * 2
  )
}

export interface LabelOverlayProps<L extends OverlayLabel> {
  /** Labels in PRIORITY order — earlier keys win the declutter. */
  labels: readonly L[]
  render: (label: L) => ReactNode
  /** Max simultaneously visible chips — constant or fn of camera.zoom. */
  maxVisible?: number | ((zoom: number) => number)
  /** NDC eligibility band: anchors with |ndc.x|,|ndc.y| <= margin stay
   *  mounted/eligible. 1.2 ≈ 20% beyond the viewport edge. */
  margin?: number
  /** Min px gap between chip boxes (0 = edges may touch). */
  gap?: number
  /** Box used before a chip's DOM node has been measured. */
  estimate?: { w: number; h: number }
}

interface ElRec {
  wrap: HTMLDivElement | null
  body: HTMLDivElement | null
  leader: HTMLDivElement | null
}

const DEFAULT_ESTIMATE = { w: 150, h: 24 }
const _v = new THREE.Vector3()
const _placed: ScreenBox[] = []
const _blocked: ScreenBox[] = []

/** Chrome keep-out zones (CSS px, centered-box form) — chips whose box
 *  overlaps the left rail, the header strip, or the agent rail are
 *  DROPPED from placement entirely (declutter-style, not clipped): a
 *  label half-hidden behind UI chrome reads as a bug, an absent one is
 *  honest. The agent chrome is measured live — it's a 360px right rail
 *  on wide screens, a bottom sheet <1100px, and a small edge tab when
 *  collapsed — so the keep-out tracks its real box at any size. */
function blockedBoxes(panelOpen: boolean, w: number, h: number): ScreenBox[] {
  _blocked.length = 0
  if (panelOpen) _blocked.push({ x: 195, y: h / 2, w: 390, h }) // left rail
  _blocked.push({ x: w / 2, y: 22, w, h: 44 }) // 44px header strip
  // live-measured agent chrome (rail, sheet, or collapsed toggle tab) —
  // absent while the rail is closed AND unmounted nowhere else
  const chrome = document.querySelector('.agent-rail, .agent-bar-toggle')
  if (chrome) {
    const r = chrome.getBoundingClientRect()
    _blocked.push({
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      w: r.width,
      h: r.height,
    })
  }
  return _blocked
}

export function LabelOverlay<L extends OverlayLabel>({
  labels,
  render,
  maxVisible = 12,
  margin = 1.2,
  gap = 4,
  estimate = DEFAULT_ESTIMATE,
}: LabelOverlayProps<L>) {
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  // keep-out rects track the left rail — the frame closure re-reads the
  // latest committed value each pass, so a one-frame stale flag is fine
  const panelOpen = useAppStore((s) => s.panelOpen)

  // One container div over the canvas — same parent drei Html targets.
  // useState initializer so StrictMode's double-invocation can't leak a div.
  const [container] = useState(() => {
    const el = document.createElement('div')
    el.className = 'label-overlay'
    Object.assign(el.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>)
    return el
  })
  const rootRef = useRef<ReactDOM.Root | null>(null)
  const els = useRef(new Map<string, ElRec>())
  const sizes = useRef(new Map<string, { w: number; h: number }>())

  const setEl =
    (key: string, slot: keyof ElRec) =>
    (el: HTMLDivElement | null) => {
      let rec = els.current.get(key)
      if (!rec) {
        rec = { wrap: null, body: null, leader: null }
        els.current.set(key, rec)
      }
      rec[slot] = el
      // Refs attach when the separate root commits — kick a frame so
      // sizes/positions pick the fresh nodes up under frameloop="demand".
      if (el) invalidate()
    }

  // Attach the container + create the chip root — declared BEFORE the
  // render effect so it exists in the same commit.
  useLayoutEffect(() => {
    const parent = gl.domElement.parentNode as HTMLElement | null
    if (!parent) return
    parent.appendChild(container)
    const root = ReactDOM.createRoot(container)
    rootRef.current = root
    return () => {
      parent.removeChild(container)
      rootRef.current = null
      root.unmount()
    }
  }, [gl, container])

  // Render the chips into the separate DOM root every commit (like drei
  // Html) — the root diffs, so unchanged chips cost ~nothing.
  useLayoutEffect(() => {
    rootRef.current?.render(
      <>
        {labels.map((l, i) => (
          <div
            key={l.key}
            ref={setEl(l.key, 'wrap')}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              visibility: 'hidden',
              zIndex: labels.length - i, // higher priority paints on top
              willChange: 'transform',
              pointerEvents: 'none',
            }}
          >
            {l.ground ? (
              <div
                ref={setEl(l.key, 'leader')}
                style={{
                  position: 'absolute',
                  left: -1,
                  top: 0,
                  width: 2,
                  height: 0,
                  transformOrigin: '50% 0',
                  background: PALETTE.ink,
                  opacity: 0.45,
                  visibility: 'hidden',
                  pointerEvents: 'none',
                }}
              />
            ) : null}
            <div
              ref={setEl(l.key, 'body')}
              style={{
                position: 'absolute',
                transform: 'translate(-50%,-50%)',
                pointerEvents: 'none',
              }}
            >
              {render(l)}
            </div>
          </div>
        ))}
      </>,
    )
  })

  // Prop/label changes need one fresh frame to re-run placement.
  useEffect(() => {
    const live = new Set(labels.map((l) => l.key))
    for (const k of [...els.current.keys()]) {
      if (!live.has(k)) {
        els.current.delete(k)
        sizes.current.delete(k)
      }
    }
    const t = setTimeout(() => invalidate(), 0) // after the chip root commits
    return () => clearTimeout(t)
  }, [labels, render, maxVisible, margin, gap, estimate, invalidate])

  // Project anchors → place chips greedily in priority order.
  useFrame((state) => {
    if (!labels.length) return
    const cam = state.camera
    cam.updateMatrixWorld() // refresh matrixWorldInverse for project()
    const w2 = state.size.width / 2
    const h2 = state.size.height / 2
    const zoom = 'zoom' in cam ? (cam as { zoom: number }).zoom : 1
    const cap = Math.max(
      0,
      typeof maxVisible === 'function' ? maxVisible(zoom) : maxVisible,
    )
    _placed.length = 0
    const blocked = blockedBoxes(panelOpen, state.size.width, state.size.height)

    for (const label of labels) {
      const rec = els.current.get(label.key)
      const wrap = rec?.wrap
      if (!wrap) continue
      _v.set(label.anchor[0], label.anchor[1], label.anchor[2]).project(cam)
      const sx = _v.x * w2 + w2
      const sy = -_v.y * h2 + h2
      let sz = sizes.current.get(label.key)
      if (!sz && rec?.body && rec.body.offsetWidth > 0) {
        sz = { w: rec.body.offsetWidth, h: rec.body.offsetHeight }
        sizes.current.set(label.key, sz)
      }
      const box: ScreenBox = {
        x: sx,
        y: sy,
        w: sz?.w ?? estimate.w,
        h: sz?.h ?? estimate.h,
      }
      const visible =
        Math.abs(_v.x) <= margin &&
        Math.abs(_v.y) <= margin &&
        _placed.length < cap &&
        !_placed.some((p) => boxesOverlap(p, box, gap)) &&
        !blocked.some((b) => boxesOverlap(b, box, 0))

      if (!visible) {
        wrap.style.visibility = 'hidden'
        if (rec?.leader) rec.leader.style.visibility = 'hidden'
        continue
      }
      _placed.push(box)
      wrap.style.visibility = 'visible'
      wrap.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`

      if (rec?.leader && label.ground) {
        _v.set(label.ground[0], label.ground[1], label.ground[2]).project(cam)
        const gx = _v.x * w2 + w2 - sx
        const gy = -_v.y * h2 + h2 - sy
        const len = Math.hypot(gx, gy)
        if (len > 4) {
          rec.leader.style.visibility = 'visible'
          rec.leader.style.height = `${len.toFixed(1)}px`
          rec.leader.style.transform = `rotate(${Math.atan2(gx, gy)}rad)`
        } else {
          rec.leader.style.visibility = 'hidden'
        }
      }
    }
  })

  // Nothing renders through the R3F reconciler — chips live in the
  // separate DOM root on `container`.
  return null
}
