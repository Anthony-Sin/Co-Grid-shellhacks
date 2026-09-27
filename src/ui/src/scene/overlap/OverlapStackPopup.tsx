/**
 * OverlapStackPopup — the floating list behind a `Σ N` stack chip.
 * When several overlap records share a spot on the map, picking one by
 * raycast alone is a coin flip; the popup lists every member (real records
 * only) so the user can pick deliberately — and when the list runs long
 * the footer offers "+N more — zoom in", which flies the camera close
 * enough that the members separate into their own pills.
 */
import { Html } from '@react-three/drei'
import { PALETTE, TIER_COLORS } from '../../lib/palette'
import { selectOverlapInScene } from '../../lib/selectOverlap'
import { useAppStore } from '../../state/store'
import { STACK_VISIBLE, type OverlapStack } from './stackData'

export function OverlapStackPopup({ stack, onClose }: { stack: OverlapStack; onClose: () => void }) {
  const setFocusTarget = useAppStore((s) => s.setFocusTarget)
  const setHoveredOverlap = useAppStore((s) => s.setHoveredOverlap)
  const selectedOverlapId = useAppStore((s) => s.selectedOverlapId)
  const shown = stack.members.slice(0, STACK_VISIBLE)
  const hidden = stack.members.length - shown.length

  return (
    <Html position={[stack.centroid[0], 60, -stack.centroid[1]]} center zIndexRange={[120, 0]}>
      <div
        style={{
          background: PALETTE.chipBg,
          border: `1px solid rgba(43,43,43,0.55)`,
          borderRadius: 10,
          boxShadow: '3px 4px 0 rgba(43,43,43,0.22)',
          minWidth: 240,
          maxWidth: 300,
          fontSize: 11,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 10px',
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            borderBottom: '1px solid rgba(43,43,43,0.18)',
          }}
        >
          <span>{stack.members.length} overlaps here</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="close overlap list"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 800 }}
          >
            ×
          </button>
        </div>
        <div style={{ maxHeight: 180, overflowY: 'auto' }}>
          {shown.map((d) => {
            const sel = d.rec.overlap_id === selectedOverlapId
            return (
              <button
                key={d.rec.overlap_id}
                type="button"
                onClick={() => selectOverlapInScene(d.rec.overlap_id, d.rec.zone)}
                onMouseEnter={() => setHoveredOverlap(d.rec.overlap_id)}
                onMouseLeave={() => setHoveredOverlap(null)}
                title={d.rec.explanation}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  padding: '5px 10px',
                  background: sel ? 'rgba(43,43,43,0.10)' : 'transparent',
                  border: 'none',
                  borderBottom: '1px solid rgba(43,43,43,0.08)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontWeight: sel ? 800 : 600,
                  color: PALETTE.chipText,
                  whiteSpace: 'nowrap',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: TIER_COLORS[d.rec.tier] ?? '#888',
                    flexShrink: 0,
                  }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {d.rec.overlap_id} · {d.labelA} ⇄ {d.labelB} · {d.rec.min_distance_km.toFixed(1)} km
                </span>
              </button>
            )
          })}
        </div>
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => {
              // focusTarget flies the camera to zoom 0.35 — close enough
              // that stack members separate into their own markup
              setFocusTarget([stack.centroid[0], -stack.centroid[1]])
              onClose()
            }}
            style={{
              width: '100%',
              padding: '6px 10px',
              background: 'rgba(43,43,43,0.06)',
              border: 'none',
              borderTop: '1px solid rgba(43,43,43,0.18)',
              cursor: 'pointer',
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: PALETTE.chipText,
            }}
          >
            +{hidden} more — zoom in
          </button>
        )}
      </div>
    </Html>
  )
}
