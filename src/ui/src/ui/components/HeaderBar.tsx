import { useAppStore } from '../../state/store'
import { useStats } from '../hooks/useApiData'
import type { SceneId } from '../../lib/projection'

const SCENES: { id: SceneId; label: string }[] = [
  { id: 'state', label: 'GA + SC' },
  { id: 'savannah', label: 'Savannah' },
  { id: 'augusta', label: 'Augusta' },
]

export function HeaderBar() {
  const activeScene = useAppStore((s) => s.activeScene)
  const setActiveScene = useAppStore((s) => s.setActiveScene)
  const stats = useStats()

  return (
    <header className="header-bar">
      <div className="brand">
        <span className="brand-title">CO-GRID</span>
        <span className="brand-sep" aria-hidden>
          —
        </span>
        <span className="brand-sub">Savannah River Corridor</span>
      </div>

      <nav className="scene-switch" aria-label="Scene switcher">
        {SCENES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`scene-btn${s.id === activeScene ? ' is-active' : ''}`}
            onClick={() => setActiveScene(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* Live counts from /api/stats — hidden while loading or when the
          backend is unreachable (panel surfaces the offline state). */}
      {stats.data ? (
        <div className="header-stats" title="Live counts from /api/stats">
          <span>
            <b className="mono">{stats.data.projects}</b> projects
          </span>
          <span className="header-stats-sep" aria-hidden>
            ·
          </span>
          <span>
            <b className="mono">{stats.data.overlaps}</b> overlaps
          </span>
          <span className="header-stats-sep" aria-hidden>
            ·
          </span>
          <span>
            <b className="mono">{stats.data.timeline_matches}</b> timeline match
            {stats.data.timeline_matches === 1 ? '' : 'es'}
          </span>
        </div>
      ) : null}
    </header>
  )
}
