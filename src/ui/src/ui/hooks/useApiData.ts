import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import type {
  FeatureCollection,
  ImpactEstimate,
  NearbyResponse,
  OverlapsResponse,
  ProjectProps,
  RegionsResponse,
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

export function deduped<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
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
    // reset on key change — otherwise a keyed hook (impact:X, nearby:Y)
    // keeps showing the PREVIOUS key's resolved data until the new fetch
    // lands (wrong-data flash on selection change)
    setState({ data: null, loading: true, error: null })
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

/** /api/regions — scenes index + zone rollup (per-region overlap counts) */
export function useRegions(): ApiDataState<RegionsResponse> {
  return useApiData('regions', api.regions)
}

/** /api/analysis/impact/{id} — geometry-derived sharing estimate for one overlap */
export function useImpact(overlapId: string | null): ApiDataState<ImpactEstimate> {
  const fetcher = useMemo(
    () => () => api.impact(overlapId ?? '__none__'),
    [overlapId],
  )
  return useApiData(`impact:${overlapId ?? 'none'}`, fetcher)
}

/** /api/analysis/nearby/{id} — staging neighborhood count for the detail card */
export function useNearby(overlapId: string | null, radiusKm = 15): ApiDataState<NearbyResponse> {
  const fetcher = useMemo(
    () => () => api.nearby(overlapId ?? '__none__', radiusKm),
    [overlapId, radiusKm],
  )
  return useApiData(`nearby:${overlapId ?? 'none'}:${radiusKm}`, fetcher)
}
