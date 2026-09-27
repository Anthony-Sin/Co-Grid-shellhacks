import { useEffect } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { MapControls } from '@react-three/drei'
import { useShallow } from 'zustand/react/shallow'
import { PALETTE } from '../lib/palette'
import type { SceneId } from '../lib/api'
import { useAppStore } from '../state/store'
import { CityScene } from './city/CityScene'
import { GridOverlay } from './grid/GridOverlay'
import { OverlapZones } from './overlap/OverlapZones'
import { FocusRig } from './FocusRig'

/**
 * Renders frames ONLY when something actually changes (frameloop="demand").
 * r3f auto-invalidates on controls interaction, pointer events and prop
 * updates; ambient animation (zone breathing, station pulses) is driven by
 * FrameTicker's slow beat. Camera flights self-pump via FocusRig.
 */
function FrameTicker({ fps = 12 }: { fps?: number }) {
  const invalidate = useThree((s) => s.invalidate)
  // The beat exists ONLY to animate zone breathing/selection pulses —
  // nothing else uses it. Ticking unconditionally meant re-rendering the
  // whole (~5.7M-vert) scene 12×/s even fully idle, which is what made the
  // map feel heavy. Run the beat only while the zones layer is on AND an
  // overlap is selected or hovered — every other moment stays at 0 fps.
  const beating = useAppStore(
    (s) => s.layers.zones && (s.selectedOverlapId != null || s.hoveredOverlapId != null),
  )
  useEffect(() => {
    if (!beating) return
    const id = window.setInterval(() => {
      if (!document.hidden) invalidate()
    }, 1000 / fps)
    return () => window.clearInterval(id)
  }, [invalidate, fps, beating])
  return null
}

/**
 * demand-loop safety net: store-driven changes that don't touch the R3F
 * element tree (store updates consumed by memos inside scene components,
 * layer toggles that remove whole subtrees) can leave the last frame on
 * screen until the next interaction. Subscribe to every scene-affecting
 * slice and poke invalidate — the commit + poke land in the same tick,
 * so the canvas repaints with the new state instead of a stale frame.
 */
function DemandInvalidator() {
  const invalidate = useThree((s) => s.invalidate)
  const filters = useAppStore(
    useShallow((s) =>
      [
        s.visibleTiers,
        s.utilityFilter,
        s.yearFilter,
        s.zoneFilter,
        s.searchText,
        s.timelineOnly,
        s.layers,
        s.mapStyle,
        s.selectedOverlapId,
        s.selectedProjectId,
        s.hoveredOverlapId,
        s.hoveredProjectId,
      ] as const,
    ),
  )
  useEffect(() => {
    invalidate()
  }, [filters, invalidate])
  return null
}

/**
 * Static lighting: the sun never moves, so the (expensive, ~5.7M-vert)
 * shadow map is baked ONCE per scene instead of re-rendered every frame.
 * Casters poke `gl.shadowMap.needsUpdate` via useShadowRefresh when their
 * geometry lands — this flag simply stops the per-frame bake.
 */
function StaticShadows() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    return () => {
      gl.shadowMap.autoUpdate = true
    }
  }, [gl])
  return null
}

/** Per-scene default views — ortho zoom scales the visible world volume.
 * State spans ~830 km, corridors ~90 km, so zoom differs ~10x. The map
 * is single-scene ('state'); corridor SceneIds exist only as composite
 * detail sources, so they fall back to the state view here. */
interface SceneView {
  position: readonly [number, number, number]
  zoom: number
  target: readonly [number, number, number]
}

const STATE_VIEW: SceneView = { position: [0, 3200, 1600], zoom: 0.0022, target: [0, 0, 0] }

const SCENE_VIEWS: Partial<Record<SceneId, SceneView>> = {
  state: STATE_VIEW,
  savannah: { position: [1400, 3200, 2500], zoom: 0.06, target: [1400, 0, 2500] },
  augusta: { position: [1400, 3200, 2500], zoom: 0.06, target: [1400, 0, 2500] },
}
// Corridor/metro SceneIds are composite detail sources, not user-facing
// scenes — any lookup beyond the table falls back to the state view.
const sceneView = (id: SceneId): SceneView => SCENE_VIEWS[id] ?? STATE_VIEW

/** Snaps camera+controls to the active scene's default view on switch. */
function SceneCamera() {
  const activeScene = useAppStore((s) => s.activeScene)
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as {
    target: { set: (x: number, y: number, z: number) => void }
    update?: () => void
  } | null
  const invalidate = useThree((s) => s.invalidate)

  useEffect(() => {
    const v = sceneView(activeScene)
    camera.position.set(v.position[0], v.position[1], v.position[2])
    if ('zoom' in camera) {
      ;(camera as { zoom: number }).zoom = v.zoom
      camera.updateProjectionMatrix()
    }
    controls?.target.set(v.target[0], v.target[1], v.target[2])
    controls?.update?.()
    invalidate()
  }, [activeScene, camera, controls, invalidate])
  return null
}

/**
 * Main 3D viewport: top-down-ish orthographic camera over a flat paper city.
 * Lighting: hemisphere fill + soft-shadowed directional sun.
 * Controls: pan + zoom free; rotation constrained to a slight tilt.
 */
export function CityCanvas() {
  const activeScene = useAppStore((s) => s.activeScene)
  const layers = useAppStore((s) => s.layers)
  // zones layer off by default — but an explicit selection still draws its
  // own zone polygon so the map answers "where is this overlap?"
  const hasSelection = useAppStore((s) => s.selectedOverlapId != null)

  return (
    <div className="canvas-wrap">
      <Canvas
        orthographic
        flat
        shadows="soft"
        frameloop="demand"
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
        camera={{
          position: STATE_VIEW.position as unknown as [number, number, number],
          zoom: STATE_VIEW.zoom,
          // The tilted map's far corners sit ~150 km from the camera ALONG
          // the view axis — a 60 km near/far slab sliced the state into a
          // horizontal band (the "cut off" strip). ±250 km covers the
          // whole sheet at every zoom (negative near is legal on ortho).
          near: -250000,
          far: 250000,
        }}
      >
        {/* transparent background — the CSS paper texture is the sheet */}

        <hemisphereLight args={[PALETTE.paper, '#B4A98F', 1.1]} />
        <directionalLight
          position={[2800, 4200, 1400]}
          intensity={1.5}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-3400}
          shadow-camera-right={3400}
          shadow-camera-top={3400}
          shadow-camera-bottom={-3400}
          shadow-camera-near={500}
          shadow-camera-far={12000}
          shadow-bias={-0.0003}
        />

        {/* invisible shadow-catcher: only shadows land on the paper */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
          <planeGeometry args={[60000, 60000]} />
          <shadowMaterial transparent opacity={0.14} />
        </mesh>

        {/* Real pipeline layers — each gated by its ViewModes layer flag;
            `labels` cascades into chips (city labels, zone labels, connector
            pills) without hiding their underlying geometry */}
        {layers.basemap && (
          <CityScene key={`city-${activeScene}`} showLabels={layers.labels} />
        )}
        {layers.projects && <GridOverlay key={`grid-${activeScene}`} />}
        {(layers.zones || hasSelection) && <OverlapZones key={`zones-${activeScene}`} />}
        <FocusRig />
        <SceneCamera />
        <StaticShadows />
        <FrameTicker fps={12} />
        <DemandInvalidator />

        <MapControls
          makeDefault
          enableDamping
          // 0.09 damping + zoomToCursor chased the still-gliding anchor
          // each wheel tick — QA measured ~40km of drift off the aimed
          // feature over 10 ticks. Lower damping settles the glide
          // sooner so the next tick re-anchors a stable point.
          dampingFactor={0.055}
          target={[0, 0, 0]}
          minPolarAngle={0}
          maxPolarAngle={0.55}
          minZoom={0.0008}
          maxZoom={1.4}
          screenSpacePanning={false}
          // The zoom range is ~640x (statewide 0.0022 -> street 1.4):
          // default speed (1.0, ~5%/notch) needs ~100 wheel ticks to reach
          // building detail — effectively unreachable, reads as a "cut
          // off" empty map. 1.9 gets overview->street in ~13 ticks; higher
          // values re-anchor the zoomToCursor point mid-glide and the
          // view drifts off the aimed feature.
          // zoomToCursor keeps the pointed feature centered like every
          // tiled web map.
          zoomSpeed={1.9}
          zoomToCursor
        />
      </Canvas>
    </div>
  )
}
