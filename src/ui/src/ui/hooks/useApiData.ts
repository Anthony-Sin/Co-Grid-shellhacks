import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import type {
  FeatureCollection,
  OverlapsResponse,
  ProjectProps,
  StatsResponse,
} from '../../lib/api'

export interface ApiDataState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

/**
 * Shared request cache keyed by endpoint. Multiple consumers (panel, detail,
 * header, legend) and React StrictMode double-mounts all share ONE fetch.
 * Rejected promises are evicted so a later mount can retry once the backend
 * is up (honest "backend offline" state, not a cached failure forever).
 */
const requestCache = new Map<string, Promise<unknown>>()

function deduped<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = requestCache.get(key)
  if (hit) return hit as Promise<T>
  const p = fetcher().catch((err: unknown) => {
    requestCache.delete(key)
    throw err
  })
  requestCache.set(key, p)
  return p
}

/**
 * StrictMode-safe API fetch hook.
 * `fetcher` must be a stable reference — all `api.*` methods are.
 * Data here is region-wide (not per-scene), so no refetch on scene change.
 */
export function useApiData<T>(key: string, fetcher: () => Promise<T>): ApiDataState<T> {
  const [state, setState] = useState<ApiDataState<T>>({
    data: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    deduped(key, fetcher)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          })
      })
    return () => {
      cancelled = true
    }
  }, [key, fetcher])

  return state
}

/** /api/stats — dashboard header counts */
export function useStats(): ApiDataState<StatsResponse> {
  return useApiData('stats', api.stats)
}

/** /api/overlaps — ranked coordination opportunities (tier asc, then distance) */
export function useOverlaps(): ApiDataState<OverlapsResponse> {
  return useApiData('overlaps', api.overlaps)
}

/** /api/projects — FeatureCollection<ProjectProps> for project_id → name/utility resolution */
export function useProjects(): ApiDataState<FeatureCollection<ProjectProps>> {
  return useApiData('projects', api.projects)
}
