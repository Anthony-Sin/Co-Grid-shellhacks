/**
 * Mini-map "area snapshot" — public surface.
 *
 * Split for the 500-line rule (AGENTS.md §1):
 *   ./miniMapSpec — MiniMapSpec type + the spec builders both detail cards
 *                   and the HTML report share (overlapMapSpec,
 *                   projectMapSpec, context helpers).
 *   ./miniMapSvg  — miniMapSvg(spec): the dependency-free SVG renderer
 *                   (real-geography crop: filled state bounds, existing
 *                   grid, crop-filtered project context, zone, markers).
 *
 * Import from './miniMap' exactly as before — this barrel re-exports both.
 */

export * from './miniMapSpec'
export * from './miniMapSat'
export * from './miniMapSvg'
