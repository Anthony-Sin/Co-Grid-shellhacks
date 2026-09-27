/**
 * Mini-map "area snapshot" — spec types + builders.
 *
 * A MiniMapSpec is the pure-data description of one thumbnail: which
 * geometries are featured, which are context, which real-world backdrop
 * layers (state bounds, existing grid) may be drawn. The renderer lives in
 * ./miniMapSvg — ONE string builder feeds both the right-rail detail cards
 * (injected via dangerouslySetInnerHTML — generated markup, no user text)
 * and the exported HTML report, so what renders in the rail is
 * byte-for-byte what lands in the downloaded file.
 *
 * Everything drawn comes from our own processed data (projects.geojson,
 * overlaps.json, basemap.geojson, state_bounds.geojson) — no tile servers,
 * no imagery, no external APIs. Layers that haven't loaded simply don't
 * render (honest absence, AGENTS.md §7).
 */

import type {
  FeatureCollection,
  BasemapProps,
  GeoFeature,
  OverlapRecord,
  ProjectProps,
  StateBoundsProps,
} from './api'
import { TIER_COLORS } from './palette'
import { SCENE_CENTERS } from './projection'
import { utilityColor } from '../ui/components/utilityColors'
import { firstCoord, geomPrims, mergePrims, siblingsWithinKm } from './geoPrims'
import type { GeomLike, XY } from './geoPrims'

const INK = '#2B2B2B'

/** One translucent zone overlay — geometry + the tier color it renders in. */
export interface ZoneSpec {
  geom: GeomLike
  color: string
}

export interface MiniMapSpec {
  /** featured projects — drawn strongest, in their utility colors */
  focus: GeoFeature<ProjectProps>[]
  /** direct counterparties — utility colors, lighter than focus */
  partners?: GeoFeature<ProjectProps>[]
  /** pre-filtered context projects (e.g. the report's 30km siblings) */
  context?: GeoFeature<ProjectProps>[]
  /** full project set — the renderer crop-filters it to the area of
   *  interest, i.e. "every filed line passing through the crop" rather
   *  than a fixed radius/cap. Focus/partner ids are excluded. */
  allProjects?: GeoFeature<ProjectProps>[]
  /** /api/basemap — existing transmission lines, substations, plants
   *  (the real grid context). Null/not-yet-loaded -> layer skipped. */
  basemap?: FeatureCollection<BasemapProps> | null
  /** primary overlap zone polygon (lon/lat rings) + tier color */
  zone?: GeomLike | null
  zoneColor?: string
  /** additional zone overlays (e.g. a project's other coordination sites) */
  zones?: ZoneSpec[]
  /** closest-point markers A/B + connector */
  closestA?: { at: XY; color: string } | null
  closestB?: { at: XY; color: string } | null
  /** GA/SC polygons — filled land + border strokes, clipped to the crop */
  states?: FeatureCollection<StateBoundsProps> | null
  /** fallback fit anchor when nothing else has geometry */
  center?: XY | null
}

/** Optional backdrop/context inputs — additively consumed by the builder;
 *  omitting them just skips those layers (old call sites keep working). */
export interface MapExtras {
  allProjects?: GeoFeature<ProjectProps>[]
  basemap?: FeatureCollection<BasemapProps> | null
  zones?: ZoneSpec[]
}

/** Filed projects within `radiusKm` of the A+B pair — nearest first.
 *  Used where a radius-limited context set is wanted up front (report). */
export function overlapContext(
  o: OverlapRecord,
  a: GeoFeature<ProjectProps> | undefined,
  b: GeoFeature<ProjectProps> | undefined,
  all: GeoFeature<ProjectProps>[],
  radiusKm = 30,
  cap = 14,
): GeoFeature<ProjectProps>[] {
  const anchor = mergePrims(
    a ? geomPrims(a.geometry) : undefined,
    b ? geomPrims(b.geometry) : undefined,
  )
  const latRef = o.midpoint?.[1] ?? firstCoord(anchor)?.[1] ?? SCENE_CENTERS.state[1]
  return siblingsWithinKm(
    all,
    anchor,
    latRef,
    radiusKm,
    new Set([o.project_a, o.project_b]),
    cap,
  )
}

export function overlapMapSpec(
  o: OverlapRecord,
  a: GeoFeature<ProjectProps> | undefined,
  b: GeoFeature<ProjectProps> | undefined,
  context: GeoFeature<ProjectProps>[],
  states: FeatureCollection<StateBoundsProps> | null,
  extras: MapExtras = {},
): MiniMapSpec {
  return {
    focus: [a, b].filter((f): f is GeoFeature<ProjectProps> => Boolean(f)),
    context,
    allProjects: extras.allProjects,
    basemap: extras.basemap ?? null,
    zone: (o.zone_geometry as GeomLike | null | undefined) ?? null,
    zoneColor: TIER_COLORS[o.tier] ?? INK,
    zones: extras.zones,
    closestA: o.closest_point_a
      ? { at: o.closest_point_a, color: utilityColor(a?.properties.utility) }
      : null,
    closestB: o.closest_point_b
      ? { at: o.closest_point_b, color: utilityColor(b?.properties.utility) }
      : null,
    states,
    center: o.midpoint ?? null,
  }
}

/** Other ends of this project's coordination records — the map's partners. */
export function projectPartnerIds(
  records: OverlapRecord[],
  projectId: string,
): Set<string> {
  const ids = new Set<string>()
  for (const o of records) {
    ids.add(o.project_a === projectId ? o.project_b : o.project_a)
  }
  return ids
}

/** Filed siblings near a single project (radius-limited context, report). */
export function projectContext(
  feature: GeoFeature<ProjectProps>,
  partnerIds: ReadonlySet<string>,
  all: GeoFeature<ProjectProps>[],
  radiusKm = 30,
  cap = 14,
): GeoFeature<ProjectProps>[] {
  const anchor = geomPrims(feature.geometry)
  const latRef = firstCoord(anchor)?.[1] ?? SCENE_CENTERS.state[1]
  const exclude = new Set(partnerIds)
  exclude.add(feature.properties.project_id)
  return siblingsWithinKm(all, anchor, latRef, radiusKm, exclude, cap)
}

export function projectMapSpec(
  feature: GeoFeature<ProjectProps>,
  partners: GeoFeature<ProjectProps>[],
  context: GeoFeature<ProjectProps>[],
  states: FeatureCollection<StateBoundsProps> | null,
  extras: MapExtras = {},
): MiniMapSpec {
  return {
    focus: [feature],
    partners,
    context,
    allProjects: extras.allProjects,
    basemap: extras.basemap ?? null,
    zones: extras.zones,
    states,
    center: firstCoord(geomPrims(feature.geometry)),
  }
}
