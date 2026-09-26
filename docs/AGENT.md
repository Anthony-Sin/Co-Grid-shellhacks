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

### Selection context

Pass `overlap_id` when a zone is selected on the map — the agent injects
the record's real fields (tier, distance, window, impact estimate) into
the system context so "explain this" resolves correctly.

## Tools (14)

`stats` · `list_projects` · `get_project` · `top_overlaps` ·
`get_overlap` · `projects_near` · `timeline_summary` · `impact_estimate`
· `gazetteer` · `data_health` · `staging_clusters` · `playbook` ·
`outage_conflicts` · `utility_matrix` · `define`

## Deterministic analysis (no model)

| route | returns |
|---|---|
| `/api/analysis/timeline` | yearly+quarterly bands, shared-window stats |
| `/api/analysis/impacts?top=` | rough savings/crew math per overlap |
| `/api/analysis/impact/{id}` | one overlap's impact detail |
| `/api/analysis/clusters?radius_km=` | staging clusters (crew-yard rule) |
| `/api/analysis/playbook?radius_km=&top=` | minimal season-years per cluster |
| `/api/analysis/calendar` | overlaps grouped by window start year |
| `/api/analysis/conflicts` | mandatory joint-outage list (tier-1 + shared window) |

## Failure modes (all handled server-side)

- unconfigured → `configured:false`, chat → 503
- provider 429/5xx → one retry, then `finish_reason:"error"`
- unknown tool / bad args → returned as data, model self-corrects
- >8 rounds → hard stop, `finish_reason:"max_rounds"`
