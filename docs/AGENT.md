# Agent API — integration contract

The analyst agent lives entirely in the backend (`src/agent/`). It answers
questions by calling **real-data tools** over the processed artifacts —
it never invents projects, overlaps, or numbers.

## Setup

```bash
# .env (never commit — server-side only)
AGENT_API_KEY=tmx_...
AGENT_BASE_URL=https://api.tensormux.com/v1   # default
AGENT_MODEL=glm-4-7-flash                      # default
```

Without a key the endpoints stay up and return `configured:false` /
`503 agent_not_configured` — the UI should degrade to a disabled bar.

## Endpoints

| route | method | body → response |
|---|---|---|
| `/api/agent/health` | GET | → `{configured, model, tools[], max_rounds}` |
| `/api/agent/chat` | POST | `{messages:[{role,content}], overlap_id?}` → `{reply, reasoning, tool_trace[], rounds, usage, finish_reason}` |
| `/api/agent/chat/stream` | POST | same body → SSE events (below) |
| `/api/agent/brief/{overlap_id}` | GET | → `{overlap_id, brief, reasoning, usage}` |

All under the vite `/api` proxy — relative paths only, keys never reach
the browser.

### SSE contract (`/api/agent/chat/stream`)

```
event: tool   data: {"tool":"top_overlaps","args":{"n":3},"ok":true}
event: tool   data: {"tool":"impact_estimate","args":{...},"ok":true}
event: final  data: {reply, reasoning, tool_trace, rounds, usage}
event: done   data: {}
```

`EventSource` can't POST — read with `fetch` + `ReadableStream` and split
on `\n\n` (working implementation in `src/ui/src/ui/components/AgentBar.tsx`).

### The `reasoning` field

`glm-4-7-flash` is a thinking model: it emits a `reasoning` field
alongside `content`. The API surfaces it verbatim — render it collapsed
("thinking…") or discard; never block on it.

### Tool calling

Two paths: native function-calling when the provider supports it
(`openai_tool_specs()` injected per request), else a fenced
```` ```tool ```` JSON block the engine parses and feeds back. In the
fenced path the system message also carries a generated
`AVAILABLE TOOLS` catalog (name — desc [arg shapes] from the same
`TOOLS` registry, so it can't drift) — without it the model has no way
to learn the tool names.

### Selection context

Pass `overlap_id` when a zone is selected on the map — the route looks up
the record and injects its real fields (tier, distance, timeline flags,
shared/adjacent windows, zone) into the last user message as
`[context: user selected {...}]`, so "explain this" resolves correctly.

## Tools (26)

`stats` · `exec_summary` · `list_projects` · `get_project` · `top_overlaps` ·
`get_overlap` · `find_overlaps` · `project_overlaps` · `projects_near` ·
`compare_overlaps` · `why_ranked` · `zone_report` · `overlap_neighbors` ·
`timeline_summary` · `impact_estimate` · `savings_rollup` · `what_if_shift` ·
`season_calendar` · `gazetteer` · `data_health` · `staging_clusters` ·
`playbook` · `outage_conflicts` · `utility_matrix` ·
`what_if_drop_utility` · `define`

`get_overlap` takes `overlap_id` (single) or `overlap_ids` (list ≤30,
batch) — multi-record questions should use the list form so they don't
burn a tool round per lookup inside the 6-round limit.

Synthesis tools: `find_overlaps` is the filtered-search primitive;
`project_overlaps` returns one project's whole portfolio;
`compare_overlaps` gives a 2-8 record side-by-side; `why_ranked`
decomposes the stored score (same ranker constants); `zone_report` and
`savings_rollup` roll up by zone/utility; `what_if_shift` is a labeled
counterfactual — it recomputes window relationships for a hypothetical
schedule slip and never mutates stored data. `get_overlap` detail also
carries `deep_link` — a `?scene=&select=` URL the agent can hand back
for an exact map view.

## Deterministic analysis (no model)

| route | returns |
|---|---|
| `/api/analysis/timeline` | yearly+quarterly bands, shared-window stats |
| `/api/analysis/impacts?top=` | rough savings/crew math per overlap |
| `/api/analysis/impact/{id}` | one overlap's impact detail |
| `/api/analysis/clusters?radius_km=` | yard-servable staging clusters + corridors |
| `/api/analysis/playbook?radius_km=&top=` | minimal season-years per yard cluster |
| `/api/analysis/calendar` | overlaps grouped by window start year |
| `/api/analysis/conflicts` | mandatory joint-outage list (tier-1 + shared window) |
| `/api/analysis/summary` | exec-summary card (dominant pair, peak season, top opportunity) |

## Failure modes (all handled server-side)

- unconfigured → `configured:false`, chat → 503
- provider 429/5xx → one retry, then `ChatError` → 502 (chat) or
  `error`+`done` SSE events (stream) — never a hung stream
- unknown tool / bad args → returned as data, model self-corrects
- >6 rounds → hard stop, `finish_reason:"round_limit"`
