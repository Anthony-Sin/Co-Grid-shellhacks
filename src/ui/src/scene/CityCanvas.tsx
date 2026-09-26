import { Canvas } from '@react-three/fiber'
import { MapControls } from '@react-three/drei'
import { PALETTE } from '../lib/palette'
import { useAppStore } from '../state/store'
import { DevPreviewScene } from './DevPreviewScene'
import { CityScene } from './city/CityScene'
import { GridOverlay } from './grid/GridOverlay'
import { OverlapZones } from './overlap/OverlapZones'

/** When the real city pipeline data is available we render it and park the
 * dev placeholder. Each flag flips independently so layers can land one
 * agent at a time. */
const USE_REAL_CITY = true

/**
 * Main 3D viewport: top-down-ish orthographic camera over a flat paper city.
 * Lighting: hemisphere fill + soft-shadowed directional sun.
 * Controls: pan + zoom free; rotation constrained to a slight tilt.
 */
export function CityCanvas() {
  const activeScene = useAppStore((s) => s.activeScene)

  return (
    <div className="canvas-wrap">
      <Canvas
        orthographic
        flat
        shadows="soft"
        dpr={[1, 2]}
        camera={{
          position: [0, 3200, 1000],
          zoom: 0.16,
          near: 1,
          far: 60000,
        }}
      >
        <color attach="background" args={[PALETTE.paper]} />
        <fog attach="fog" args={[PALETTE.paper, 6000, 32000]} />

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

        {/* big paper ground sheet, receives all shadows */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
          <planeGeometry args={[60000, 60000]} />
          <meshStandardMaterial color={PALETTE.ground} roughness={1} metalness={0} />
        </mesh>

        {/* Real pipeline layers (each owned by a separate agent) */}
        {USE_REAL_CITY ? (
          <CityScene key={`city-${activeScene}`} />
        ) : (
          <DevPreviewScene key={activeScene} seed={`dev-${activeScene}`} />
        )}
        <GridOverlay key={`grid-${activeScene}`} />
        <OverlapZones key={`zones-${activeScene}`} />

        <MapControls
          makeDefault
          enableDamping
          dampingFactor={0.09}
          minPolarAngle={0}
          maxPolarAngle={0.55}
          minZoom={0.02}
          maxZoom={1.4}
          screenSpacePanning={false}
        />
      </Canvas>
    </div>
  )
}
