/**
 * Typed client for the CO-GRID FastAPI backend.
 * Vite proxies /api -> http://127.0.0.1:8000 (see vite.config.ts).
 * All data returned is REAL — HIFLD / OSM / public PSC filings. Never mock.
 */

export type SceneId = 'savannah' | 'augusta' | 'state'
export type Tier = 1 | 2 | 3 | 4

// ---------- /api/city/{scene} ----------
export interface CityBuilding {
  id: number
  footprint: [number, number][] // local meters [x,y]
  height: number
  kind: 'residential' | 'commercial' | 'civic' | 'industrial' | 'church' | 'default'
  name?: string
}
export interface CityRoad {
  kind: string
  rank: number
  line: [number, number][]
  name?: string
}
export interface CityPolygon {
  kind: string
  polygon?: [number, number][]
  /** Open polyline variant — e.g. rivers in the statewide scene. */
  line?: [number, number][]
  name?: string
}
export interface CityPoi {
  name: string
  kind: string
  x: number
  y: number
  /** OSM population when tagged — lets the label picker rank real city size. */
  pop?: number
}
export interface CityScene {
  scene: SceneId
  center: [number, number]
  source: string
  counts: Record<string, number>
  bounds_m: { min_x: number; max_x: number; min_y: number; max_y: number }
  buildings: CityBuilding[]
  roads: CityRoad[]
  water: CityPolygon[]
  parks: CityPolygon[]
  pois?: CityPoi[]
}

// ---------- /api/projects & /api/basemap (GeoJSON) ----------
export interface ProjectProps {
  project_id: string
  utility: string
  name: string
  kind: 'transmission_line' | 'substation' | 'plant' | 'upgrade' | 'reconductor'
  voltage_kv?: number | null
  start_year?: number | null
  end_year?: number | null
  status: 'planned' | 'under_construction' | 'proposed'
  location_confidence: 'verified' | 'endpoint_only' | 'approximate'
  source: string
  notes?: string
  zones?: string[]
  geometry_basis?: string
}
export interface BasemapProps {
  layer:
    | 'existing_transmission_line'
    | 'existing_substation'
    | 'existing_power_plant'
    | 'service_territory'
  name: string
  owner: string
  voltage_kv?: number | null
  fuel?: string | null
  capacity_mw?: number | null
  source: string
}
export interface GeoFeature<P> {
  type: 'Feature'
  properties: P
  geometry: {
    type: string
    coordinates: unknown // GeoJSON coords — WGS84 lon/lat
  }
}
export interface FeatureCollection<P> {
  type: 'FeatureCollection'
  source?: string
  features: GeoFeature<P>[]
}

// ---------- /api/overlaps ----------
export interface OverlapRecord {
  overlap_id: string
  project_a: string
  project_b: string
  utilities: string[]
  min_distance_km: number
  tier: Tier
  tier_label: 'touching' | 'shared_row' | 'shared_logistics' | 'shared_crews'
  tier_threshold_km: number
  timeline_overlap: boolean
  shared_window?: { start: number; end: number } | null
  closest_point_a: [number, number] // lon/lat
  closest_point_b: [number, number]
  midpoint: [number, number]
  score: number
  explanation: string
  cost?: {
    shared_row_km: number
    shared_row_acres: number
    est_savings_usd_low: number
    est_savings_usd_high: number
    basis: string
  } | null
  zone: string
  zone_geometry?: { type: string; coordinates: number[][][] } | null
}
export interface OverlapsResponse {
  generated_at: string
  region: string
  project_count?: number
  overlaps: OverlapRecord[]
}

export interface StatsResponse {
  projects: number
  by_utility: Record<string, number>
  overlaps: number
  by_tier: Record<string, number>
  timeline_matches: number
}

export interface RegionsResponse {
  regions: { id: string; label: string; built: boolean }[]
  zones: { id: string; projects: number; overlaps: number }[]
}

// ---------- /api/agent/* ----------
export interface AgentHealth {
  configured: boolean
  model: string | null
  tools: string[]
  max_rounds: number
}

export interface AgentTrace {
  tool: string
  args: Record<string, unknown>
  preview: string
}

export interface AgentReply {
  reply: string
  reasoning: string | null
  tool_trace: AgentTrace[]
  rounds: number
  usage: Record<string, number>
  finish_reason: string
}

export interface ImpactEstimate {
  overlap_id: string
  shared_corridor_km: number | null
  shared_row_acres: number | null
  shared_window_months: number | null
  crew_share_days: number | null
  est_savings_usd_range: { low: number | null; high: number | null; basis: string } | null
  confidence: string
  assumptions: string[]
}

export interface AgentBrief {
  overlap_id: string
  brief: string
  reasoning: string | null
  usage: Record<string, number>
}

export interface NearbyResponse {
  overlap_id: string
  midpoint: [number, number]
  radius_km: number
  neighbor_count: number
  neighbors: { overlap_id: string; distance_km: number; tier: number }[]
}

// ---------- fetch helpers ----------
async function get<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`)
  return (await r.json()) as T
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}))
    throw new Error(detail?.detail || `${path} -> HTTP ${r.status}`)
  }
  return (await r.json()) as T
}

export const api = {
  health: () => get<{ ok: boolean; processed: string[] }>('/api/health'),
  city: (scene: SceneId) => get<CityScene>(`/api/city/${scene}`),
  projects: () => get<FeatureCollection<ProjectProps>>('/api/projects'),
  basemap: () => get<FeatureCollection<BasemapProps>>('/api/basemap'),
  overlaps: () => get<OverlapsResponse>('/api/overlaps'),
  stats: () => get<StatsResponse>('/api/stats'),
  regions: () => get<RegionsResponse>('/api/regions'),

  agentHealth: () => get<AgentHealth>('/api/agent/health'),
  agentChat: (messages: { role: string; content: string }[], overlapId?: string | null) =>
    post<AgentReply>('/api/agent/chat', {
      messages,
      ...(overlapId ? { overlap_id: overlapId } : {}),
    }),
  agentBrief: (overlapId: string) => get<AgentBrief>(`/api/agent/brief/${overlapId}`),

  impact: (overlapId: string) => get<ImpactEstimate>(`/api/analysis/impact/${overlapId}`),
  nearby: (overlapId: string, radiusKm = 15) =>
    get<NearbyResponse>(`/api/analysis/nearby/${overlapId}?radius_km=${radiusKm}`),
  analysisBrief: (overlapId: string) =>
    get<{ overlap_id: string; brief: string; deterministic: boolean }>(
      `/api/analysis/brief/${overlapId}`),
}
