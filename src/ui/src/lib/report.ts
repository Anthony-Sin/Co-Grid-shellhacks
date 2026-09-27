/**
 * Export report — builds a single self-contained, dependency-free HTML file
 * for a selected record (Blob + a.download). Everything in it is real filed
 * data: the mini-map is the same inline-SVG string the card shows
 * (miniMap.ts), the filing table links the filed sources, the Gantt is plain
 * HTML bars, and the footer states the provenance + spec honestly.
 * Print-friendly: monochrome paper/ink + the same utility/tier colors.
 */

import { TIER_COLORS } from './palette'
import { utilityColor } from '../ui/components/utilityColors'
import {
  buildWindow,
  esc,
  fmtLonLat,
  fmtUsd,
  humanize,
  parseSource,
  yearsOf,
  voltageOf,
} from './format'
import {
  miniMapSvg,
  overlapContext,
  overlapMapSpec,
  prefetchSatTiles,
  projectContext,
  projectMapSpec,
  projectPartnerIds,
} from './miniMap'
import type {
  FeatureCollection,
  GeoFeature,
  ImpactEstimate,
  NearbyResponse,
  OverlapRecord,
  ProjectProps,
  StateBoundsProps,
} from './api'

const INK = '#2b2b2b'

/* ------------------------------- shell + css ------------------------------- */

const REPORT_CSS = `:root{color-scheme:light}
*{box-sizing:border-box;margin:0;padding:0}
body{font:13px/1.5 'Avenir Next','Segoe UI',system-ui,-apple-system,sans-serif;background:#f5f2ea;color:${INK};padding:30px 26px}
main{max-width:720px;margin:0 auto}
.brand{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;opacity:.6}
h1{font-family:'SF Mono','Cascadia Code',Consolas,monospace;font-size:20px;letter-spacing:.03em;margin-top:4px;overflow-wrap:anywhere}
.sub{font-size:12px;opacity:.75;margin-top:2px}
.tier{display:inline-flex;align-items:center;gap:7px;margin-top:9px;padding:2px 10px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;border:1.5px solid ${INK};border-radius:999px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;border:1.5px solid ${INK};vertical-align:-1px}
figure{margin-top:14px}
figure svg{display:block;width:100%;height:auto;border:1.5px solid ${INK};border-radius:10px}
figcaption{font-size:10px;opacity:.6;margin-top:4px}
h2{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;opacity:.6;margin:20px 0 8px;padding-top:10px;border-top:1px dashed rgba(43,43,43,.35)}
table{width:100%;border-collapse:collapse;font-size:12px}
td,th{padding:3px 0;vertical-align:top;text-align:left}
td.k{opacity:.65;width:38%;padding-right:10px}
td.v,th.v{font-weight:700;text-align:right;font-family:'SF Mono','Cascadia Code',Consolas,monospace;font-size:11.5px}
th.v{padding-left:14px}
td.v.plain{font-family:inherit;font-weight:600}
a{color:${INK};font-weight:700;text-decoration:underline;text-decoration-style:dotted}
.src{font-size:10.5px;opacity:.7;overflow-wrap:anywhere;text-align:right}
.src .n{display:block;opacity:.8}
.gantt{margin-top:6px}
.gr{display:flex;align-items:center;gap:6px;margin:3px 0}
.gt{width:14px;flex:none;font-size:9px;font-weight:800;text-align:center;opacity:.55;font-family:'SF Mono','Cascadia Code',Consolas,monospace}
.gtrack{position:relative;flex:1;height:11px;border:1px solid rgba(43,43,43,.25);border-radius:5px;background:rgba(255,255,255,.45)}
.gbar{position:absolute;top:1px;bottom:1px;border-radius:3px;opacity:.45}
.gwin{top:-1px;bottom:-1px;opacity:1;border:1.5px solid rgba(43,43,43,.85);border-radius:4px}
.gadj{border-style:dashed;background:repeating-linear-gradient(45deg,rgba(43,43,43,.3) 0,rgba(43,43,43,.3) 2px,transparent 2px,transparent 5px)}
.gax{display:flex;justify-content:space-between;padding-left:20px;font-size:9px;font-weight:700;opacity:.55;font-family:'SF Mono','Cascadia Code',Consolas,monospace}
.gcap{padding-left:20px;margin-top:3px;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.6}
.na{font-size:9.5px;font-style:italic;opacity:.5;padding-left:5px}
.expl{font-size:12.5px;line-height:1.55;margin-top:12px}
.basis{font-size:10.5px;opacity:.65;margin-top:6px;line-height:1.45}
.mono{font-family:'SF Mono','Cascadia Code',Consolas,monospace;font-size:11px}
tr+tr td{border-top:1px dotted rgba(43,43,43,.15)}
footer{margin-top:24px;padding-top:10px;border-top:1.5px solid ${INK};font-size:10px;opacity:.65;line-height:1.55}
@media print{body{padding:8mm 4mm}figure svg{max-height:70mm}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}}`

function footerHtml(): string {
  return `<footer>generated ${esc(new Date().toISOString())} · CO-GRID (gridlock challenge)<br>
Map + figures drawn from CO-GRID processed filings — SCRTP/SERTP regional plans, GA/SC PSC dockets, HIFLD; no third-party tiles or imagery. Distances are closest-point between filed geometries; tiers per the 40 km spec (touching · &lt;1.6 km shared ROW · &lt;8 km shared logistics · &lt;40 km shared crews). Filed sources linked above.</footer>`
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${REPORT_CSS}</style></head>
<body><main>
<div class="brand">CO-GRID · coordination report</div>
${body}
${footerHtml()}
</main></body></html>
`
}

/* ----------------------------- html fragments ------------------------------ */

/** "url (note)" filed source -> clickable domain link + verbatim note. */
function srcHtml(source: string | undefined): string {
  const s = parseSource(source)
  if (!s.raw) return ''
  if (!s.url) return `<div class="src">source: ${esc(s.raw)}</div>`
  return `<div class="src">source: <a href="${esc(s.url)}">${esc(s.domain)}</a>${
    s.note ? `<span class="n">${esc(s.note)}</span>` : ''
  }</div>`
}

const row = (k: string, v: string, mono = true): string =>
  `<tr><td class="k">${esc(k)}</td><td class="v${mono ? '' : ' plain'}">${v}</td></tr>`

/** Schedule strip -> plain HTML bars (same math as the card's ScheduleStrip). */
function ganttHtml(
  a: ProjectProps | undefined,
  b: ProjectProps | undefined,
  o: OverlapRecord,
  tierColor: string,
): string {
  const win =
    o.timeline_overlap && o.shared_window
      ? { ...o.shared_window, adjacent: false }
      : o.timeline_adjacent && o.adjacent_window
        ? { ...o.adjacent_window, adjacent: true }
        : null
  const pts = [
    a?.start_year,
    a?.end_year,
    b?.start_year,
    b?.end_year,
    win?.start,
    win?.end,
  ].filter((y): y is number => typeof y === 'number')
  if (!pts.length) return '<p class="na">filed years n/a</p>'
  const lo = Math.min(...pts) - 1
  const span = Math.max(1, Math.max(...pts) + 1 - lo)
  const px = (y: number) => `${(((y - lo) / span) * 100).toFixed(2)}%`
  const pw = (s: number, e: number) => `${Math.max(((e - s) / span) * 100, 1.5).toFixed(2)}%`
  const projBar = (p: ProjectProps | undefined): string => {
    const s = p?.start_year ?? p?.end_year
    const e = p?.end_year ?? p?.start_year
    if (s == null || e == null) return '<span class="na">filed years n/a</span>'
    return `<i class="gbar" style="left:${px(s)};width:${pw(s, e)};background:${utilityColor(
      p?.utility,
    )}"></i>`
  }
  const winBar = win
    ? `<i class="gbar gwin${win.adjacent ? ' gadj' : ''}" style="left:${px(
        win.start,
      )};width:${pw(win.start, win.end)};${
        win.adjacent ? `border-color:${tierColor}` : `background:${tierColor}`
      }"></i>`
    : '<span class="na">no shared window</span>'
  const gr = (tag: string, bar: string) =>
    `<div class="gr"><span class="gt">${tag}</span><div class="gtrack">${bar}</div></div>`
  return (
    `<div class="gantt">` +
    gr('A', projBar(a)) +
    gr('B', projBar(b)) +
    gr(win?.adjacent ? '→' : '∩', winBar) +
    `<div class="gax"><span>${lo}</span><span>${lo + span}</span></div>` +
    (win?.adjacent ? `<div class="gcap">handoff window — not concurrent</div>` : '') +
    `</div>`
  )
}

/* ------------------------------- reports ----------------------------------- */

export interface OverlapReportArgs {
  o: OverlapRecord
  projectById: Map<string, ProjectProps>
  featureById: Map<string, GeoFeature<ProjectProps>>
  features: GeoFeature<ProjectProps>[]
  states: FeatureCollection<StateBoundsProps> | null
  neighbors?: NearbyResponse | null
  impact?: ImpactEstimate | null
  rank?: number
  total?: number
}

export async function overlapReportHtml(args: OverlapReportArgs): Promise<string> {
  const { o, projectById, featureById, features, states, neighbors, impact, rank, total } =
    args
  const pa = projectById.get(o.project_a)
  const pb = projectById.get(o.project_b)
  const fa = featureById.get(o.project_a)
  const fb = featureById.get(o.project_b)
  const tierColor = TIER_COLORS[o.tier] ?? INK
  const spec = overlapMapSpec(o, fa, fb, overlapContext(o, fa, fb, features), states)
  // embed tiles as data URIs so the downloaded file is self-contained
  await prefetchSatTiles(spec)
  const svg = miniMapSvg(spec)
  const hasSavings = (o.cost?.est_savings_usd_high ?? 0) > 0

  // filing table — one row per filed field, A/B side by side
  const cell = (v: string) => `<td class="v">${v}</td>`
  const filing =
    `<table><tr><td class="k"></td>` +
    `<th class="v"><span class="dot" style="background:${utilityColor(pa?.utility)}"></span> A</th>` +
    `<th class="v"><span class="dot" style="background:${utilityColor(pb?.utility)}"></span> B</th></tr>` +
    `<tr><td class="k">project</td>${cell(`<b>${esc(pa?.name ?? o.project_a)}</b>`)}${cell(
      `<b>${esc(pb?.name ?? o.project_b)}</b>`,
    )}</tr>` +
    `<tr><td class="k">utility</td>${cell(esc(pa?.utility ?? '—'))}${cell(
      esc(pb?.utility ?? '—'),
    )}</tr>` +
    `<tr><td class="k">kind</td>${cell(esc(humanize(pa?.kind) || '—'))}${cell(
      esc(humanize(pb?.kind) || '—'),
    )}</tr>` +
    `<tr><td class="k">voltage</td>${cell(esc(voltageOf(pa)))}${cell(esc(voltageOf(pb)))}</tr>` +
    `<tr><td class="k">build window</td>${cell(esc(yearsOf(pa)))}${cell(esc(yearsOf(pb)))}</tr>` +
    `<tr><td class="k">status</td>${cell(esc(humanize(pa?.status) || '—'))}${cell(
      esc(humanize(pb?.status) || '—'),
    )}</tr>` +
    `<tr><td class="k">confidence</td>${cell(esc(pa?.location_confidence ?? '—'))}${cell(
      esc(pb?.location_confidence ?? '—'),
    )}</tr>` +
    `<tr><td class="k"></td><td class="v">${srcHtml(pa?.source)}</td><td class="v">${srcHtml(
      pb?.source,
    )}</td></tr>` +
    `</table>`

  // coordination-value rows — same honesty rules as the card
  const rows: string[] = [
    row('closest distance', `${o.min_distance_km.toFixed(3)} km`),
    row('region', esc(o.zone?.replace(/_/g, ' ') ?? '—'), false),
    row('score', o.score.toFixed(1)),
    row(
      'shared window',
      o.timeline_overlap && o.shared_window
        ? esc(`${o.shared_window.start}–${o.shared_window.end}`)
        : o.timeline_adjacent && o.adjacent_window
          ? esc(`adjacent ${o.adjacent_window.start}–${o.adjacent_window.end} (handoff)`)
          : 'no overlap',
    ),
  ]
  if (neighbors) rows.push(row('sites within 15 km', String(neighbors.neighbor_count)))
  let costBlock = ''
  if (o.cost) {
    if (o.cost.shared_row_km > 0)
      rows.push(row('shared corridor', `${o.cost.shared_row_km.toFixed(1)} km`))
    if (hasSavings) {
      rows.push(row('shared ROW', `${o.cost.shared_row_acres.toFixed(1)} acres`))
      rows.push(
        row(
          'est. savings',
          esc(`${fmtUsd(o.cost.est_savings_usd_low)} – ${fmtUsd(o.cost.est_savings_usd_high)}`),
        ),
      )
    } else {
      costBlock += `<p class="basis">crew/logistics coordination — no land savings quantified</p>`
    }
    costBlock += `<p class="basis">${esc(o.cost.basis)}</p>`
  } else if (impact && impact.est_savings_usd_range) {
    const r = impact.est_savings_usd_range
    if (impact.shared_corridor_km != null)
      rows.push(row('shared corridor', `${impact.shared_corridor_km.toFixed(1)} km`))
    if (impact.shared_row_acres != null)
      rows.push(row('shared ROW', `${impact.shared_row_acres.toFixed(1)} acres`))
    if (impact.shared_window_months != null)
      rows.push(row('shared window', `${impact.shared_window_months} months`))
    if (impact.crew_share_days != null)
      rows.push(row('crew-share window', `${impact.crew_share_days} days`))
    rows.push(
      row(
        'est. savings',
        r.low != null && r.high != null && r.high > 0
          ? esc(`${fmtUsd(r.low)} – ${fmtUsd(r.high)}`)
          : 'n/a',
      ),
    )
    costBlock += `<p class="basis">${esc(r.basis)} (${esc(impact.confidence)})</p>`
  } else {
    costBlock += `<p class="basis">No cost estimate published for this pair.</p>`
  }

  const nbs = neighbors?.neighbors ?? []
  const nbRows = nbs
    .slice(0, 10)
    .map(
      (n) =>
        `<tr><td class="mono">${esc(n.overlap_id)}</td><td><span class="dot" style="background:${
          TIER_COLORS[n.tier as keyof typeof TIER_COLORS] ?? INK
        }"></span> tier ${n.tier}</td><td class="v">${n.distance_km.toFixed(1)} km</td></tr>`,
    )
    .join('')

  const body =
    `<h1>${esc(o.overlap_id)}</h1>` +
    `<div class="tier"><span class="dot" style="background:${tierColor}"></span>${esc(
      humanize(o.tier_label),
    )} · tier ${o.tier}${rank ? ` · rank #${rank}${total ? ` of ${total}` : ''}` : ''}</div>` +
    `<p class="expl">${esc(o.explanation)}</p>` +
    `<figure>${svg}<figcaption>area snapshot — ${esc(
      'imagery: esri world imagery · map data: CO-GRID processed filings',
    )} · overlap zone in tier color · A/B = closest points</figcaption></figure>` +
    `<h2>Filed projects</h2>${filing}` +
    `<h2>Schedule</h2>${ganttHtml(pa, pb, o, tierColor)}` +
    `<h2>Coordination value</h2><table>${rows.join('')}</table>${costBlock}` +
    (neighbors == null
      ? ''
      : `<h2>Nearby coordination sites <span style="text-transform:none">(ranked by distance)</span></h2>` +
        (nbRows
          ? `<table>${nbRows}</table>`
          : `<p class="basis">no other coordination sites within 15 km</p>`)) +
    `<h2>Closest points (lon, lat)</h2><div class="mono">A&nbsp;&nbsp;${esc(
      fmtLonLat(o.closest_point_a),
    )}<br>B&nbsp;&nbsp;${esc(fmtLonLat(o.closest_point_b))}</div>`

  return shell(`CO-GRID ${o.overlap_id} — coordination report`, body)
}

export interface ProjectReportArgs {
  feature: GeoFeature<ProjectProps>
  features: GeoFeature<ProjectProps>[]
  featureById: Map<string, GeoFeature<ProjectProps>>
  records: OverlapRecord[]
  states: FeatureCollection<StateBoundsProps> | null
}

export async function projectReportHtml(args: ProjectReportArgs): Promise<string> {
  const { feature, features, featureById, records, states } = args
  const p = feature.properties
  const pid = p.project_id
  const color = utilityColor(p.utility)
  const partnerIds = projectPartnerIds(records, pid)
  const partners = [...partnerIds]
    .map((id) => featureById.get(id))
    .filter((f): f is GeoFeature<ProjectProps> => Boolean(f))
  const spec = projectMapSpec(
    feature,
    partners,
    projectContext(feature, partnerIds, features),
    states,
  )
  await prefetchSatTiles(spec)
  const svg = miniMapSvg(spec)
  const zones = (p.zones ?? []).map(humanize).filter(Boolean)

  const filing =
    `<table>` +
    row('project_id', esc(pid)) +
    row(
      'utility',
      `<span class="dot" style="background:${color}"></span> ${esc(p.utility || 'not filed')}`,
      false,
    ) +
    row('kind', esc(humanize(p.kind) || 'not filed'), false) +
    row('voltage', esc(p.voltage_kv != null ? `${p.voltage_kv} kV` : 'not filed')) +
    row('build window', esc(buildWindow(p.start_year, p.end_year))) +
    row('status', esc(humanize(p.status) || 'not filed'), false) +
    row('region', esc(zones.length ? zones.join(', ') : 'not filed'), false) +
    row('location confidence', esc(p.location_confidence ?? 'not filed'), false) +
    `<tr><td class="k">source</td><td class="v plain">${
      p.source ? srcHtml(p.source) : 'not filed'
    }</td></tr>` +
    `</table>` +
    (p.notes ? `<p class="basis">${esc(p.notes)}</p>` : '')

  const recRows = records.slice(0, 15).map((o, i) => {
    const partnerId = o.project_a === pid ? o.project_b : o.project_a
    const partner = featureById.get(partnerId)?.properties
    const win =
      o.timeline_overlap && o.shared_window
        ? `${o.shared_window.start}–${o.shared_window.end}`
        : o.timeline_adjacent && o.adjacent_window
          ? `→ ${o.adjacent_window.start}–${o.adjacent_window.end}`
          : '—'
    return (
      `<tr><td class="k mono">${i + 1}</td>` +
      `<td class="mono">${esc(o.overlap_id)}</td>` +
      `<td><span class="dot" style="background:${utilityColor(
        partner?.utility,
      )}"></span> ${esc(partner?.name ?? partnerId)}</td>` +
      `<td><span class="dot" style="background:${TIER_COLORS[o.tier] ?? INK}"></span> ${esc(
        humanize(o.tier_label),
      )}</td>` +
      `<td class="v">${o.min_distance_km.toFixed(1)} km</td>` +
      `<td class="v">${esc(win)}</td></tr>`
    )
  })

  const body =
    `<h1>${esc(p.name || pid)}</h1>` +
    `<div class="sub mono">${esc(pid)}</div>` +
    `<div class="tier"><span class="dot" style="background:${color}"></span>${esc(
      p.utility || 'utility not filed',
    )}</div>` +
    `<figure>${svg}<figcaption>area snapshot — map data: CO-GRID processed filings · coordination partners in utility colors, siblings dimmed</figcaption></figure>` +
    `<h2>Filing</h2>${filing}` +
    `<h2>Coordination records (${records.length})</h2>` +
    (records.length
      ? `<table>${recRows.join('')}</table>` +
        (records.length > 15
          ? `<p class="basis">top 15 of ${records.length} — the ranked panel holds the full list</p>`
          : '')
      : `<p class="basis">no coordination records filed for this project</p>`)

  return shell(`CO-GRID ${pid} — project report`, body)
}

/* ------------------------------- download ---------------------------------- */

/** Blob + a.download — one self-contained .html file, no dependencies. */
export function downloadHtml(filename: string, html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // give the browser a beat to consume the blob before revoking
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
