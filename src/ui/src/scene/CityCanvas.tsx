import { useEffect } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { MapControls } from '@react-three/drei'
import { PALETTE } from '../lib/palette'
import { useAppStore } from '../state/store'
import { DevPreviewScene } from './DevPreviewScene'
import { CityScene } from './city/CityScene'
import { GridOverlay } from './grid/GridOverlay'
import { OverlapZones } from './overlap/OverlapZones'
import { FocusRig } from './FocusRig'

/** When the real city pipeline data is available we render it and park the
 * dev placeholder. Each flag flips independently so layers can land one
 * agent at a time. */
const USE_REAL_CITY = true

/**
 * Renders frames ONLY when something actually changes (frameloop="demand").
 * r3f auto-invalidates on controls interaction, pointer events and prop
 * updates; ambient animation (zone breathing, station pulses) is driven by
 * FrameTicker's slow beat. Camera flights self-pump via FocusRig.
 */
function FrameTicker({ fps = 12 }: { fps?: number }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) invalidate()
    }, 1000 / fps)
    return () => window.clearInterval(id)
  }, [invalidate, fps])
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
 * State spans ~830 km, corridors ~90 km, so zoom differs ~10x. */
const SCENE_VIEWS = {
  state: { position: [0, 3200, 1600] as const, zoom: 0.0022, target: [0, 0, 0] as const },
  savannah: { position: [1400, 3200, 2500] as const, zoom: 0.06, target: [1400, 0, 2500] as const },
  augusta: { position: [1400, 3200, 2500] as const, zoom: 0.06, target: [1400, 0, 2500] as const },
} as const

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
    const v = SCENE_VIEWS[activeScene] ?? SCENE_VIEWS.savannah
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
          position: [1400, 3200, 2500],
          zoom: 0.06,
          near: 1,
          far: 60000,
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
        {layers.basemap &&
          (USE_REAL_CITY ? (
            <CityScene key={`city-${activeScene}`} showLabels={layers.labels} />
          ) : (
            <DevPreviewScene key={activeScene} seed={`dev-${activeScene}`} showLabels={layers.labels} />
          ))}
        {layers.projects && <GridOverlay key={`grid-${activeScene}`} />}
        {layers.zones && <OverlapZones key={`zones-${activeScene}`} />}
        <FocusRig />
        <SceneCamera />
        <StaticShadows />
        <FrameTicker fps={12} />

        <MapControls
          makeDefault
          enableDamping
          dampingFactor={0.09}
          target={[1400, 0, 2500]}
          minPolarAngle={0}
          maxPolarAngle={0.55}
          minZoom={0.0008}
          maxZoom={1.4}
          screenSpacePanning={false}
        />
      </Canvas>
    </div>
  )
}
