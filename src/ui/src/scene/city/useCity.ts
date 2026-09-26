import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import type { CityScene, SceneId } from '../../lib/api'

export interface CityState {
  data: CityScene | null
  loading: boolean
  error: Error | null
}

/**
 * Fetch `/api/city/{scene}` (real OSM extract, ~25 MB JSON).
 * StrictMode-safe: a cancelled flag ignores stale resolutions from the
 * first effect invocation or after the scene has switched away.
 * On error the caller renders nothing — never fabricated fallback geometry.
 */
export function useCity(scene: SceneId): CityState {
  const [state, setState] = useState<CityState>({ data: null, loading: true, error: null })

  useEffect(() => {
    let stale = false
    setState({ data: null, loading: true, error: null })

    api
      .city(scene)
      .then((data) => {
        if (!stale) setState({ data, loading: false, error: null })
      })
      .catch((e: unknown) => {
        if (!stale) {
          setState({ data: null, loading: false, error: e instanceof Error ? e : new Error(String(e)) })
        }
      })

    return () => {
      stale = true
    }
  }, [scene])

  return state
}
