"""Agentic loop — multi-round tool use over the OpenAI-compatible endpoint.

The model is the CO-GRID coordination analyst. Ground rules in the system
prompt force answers to come from tool data only (AGENTS.md §7 — no
fabricated projects/numbers). Two invocation styles are supported:

  1. Native `tools` function-calling (preferred; detected per response).
  2. Fallback "action protocol": the model emits ```tool blocks with
     {"tool": name, "args": {...}}; we execute and feed results back.
     Used when the endpoint ignores/rejects the tools payload.

Every round records a trace entry the UI can show as "thinking".
"""
from __future__ import annotations

import json
import re
from typing import Any

from .client import AgentConfig, ChatError, chat_completion
from .tools import TOOLS, openai_tool_specs, run_tool

MAX_ROUNDS = 6
MAX_TOOL_RESULT_CHARS = 6000

SYSTEM_PROMPT = """You are the CO-GRID coordination analyst — an expert on electric
utility transmission planning in the Savannah River corridor (Georgia +
South Carolina).

STRICT RULES:
- Answer ONLY using tool results. Never invent project names, dates,
  distances, costs, or overlap records. If data is missing, say so plainly.
- Cite real identifiers: overlap_id (e.g. OV-0042) and project names.
- Utilities: DESC (Dominion Energy South Carolina), GPC (Georgia Power),
  SanteeCooper (SCPSA). Tiers: 1=touching, 2=<1.6km shared ROW,
  3=<8km logistics, 4=<40km crews. Timeline overlap is the secondary signal.
- `timeline_overlap`=true means build windows genuinely intersect (crews
  co-present; joint outages feasible). `timeline_adjacent`=true means
  windows roll end-to-start — a crew handoff opportunity, NOT a shared
  window; never describe it as overlapping.
- Be concise: short paragraphs or tight bullets. No filler.
- When asked about an overlap the user selected, call get_overlap with its id.

If tools are unavailable, emit a fenced block:
```tool
{"tool": "<name>", "args": {...}}
```
then stop — the system runs it and replies with the result.
"""

_TOOL_BLOCK = re.compile(r"```tool\s*(\{.*?\})\s*```", re.DOTALL)


def _truncate(obj: Any, limit: int = MAX_TOOL_RESULT_CHARS) -> str:
    s = json.dumps(obj, default=str)
    return s if len(s) <= limit else s[:limit] + "…(truncated)"


def _context_card() -> dict:
    try:
        stats = run_tool("stats", {})
        return {"dataset_stats": stats.get("result")}
    except Exception:
        return {}


def iter_chat(
    cfg: AgentConfig,
    history: list[dict],
    use_native_tools: bool = True,
):
    """Generator form of the loop — yields ("tool", trace_entry) events as
    each tool call completes; the final dict is the return value. The SSE
    route consumes this; `run_chat` wraps it for callers that want only
    the result."""
    return (yield from _drive(cfg, history, use_native_tools))


def run_chat(
    cfg: AgentConfig,
    history: list[dict],
    use_native_tools: bool = True,
) -> dict:
    """Drive the loop until the model answers in plain text.

    history: prior [{role, content}] (assistant/tool messages from earlier
    turns are the caller's problem to keep or trim).
    Returns {reply, reasoning, tool_trace, rounds, usage}.
    """
    gen = _drive(cfg, history, use_native_tools)
    while True:
        try:
            next(gen)
        except StopIteration as stop:
            return stop.value


def _drive(cfg: AgentConfig, history: list[dict], use_native_tools: bool):
    stats = _context_card()
    messages = [{"role": "system", "content": SYSTEM_PROMPT + "\nLIVE DATA: " + json.dumps(stats)}]
    messages.extend(history)

    specs = openai_tool_specs() if use_native_tools else None
    trace: list[dict] = []
    total_usage: dict[str, int] = {}
    last_reasoning: str | None = None

    for _round in range(MAX_ROUNDS):
        resp = chat_completion(cfg, messages, tools=specs)
        msg = resp["raw_message"]
        last_reasoning = resp.get("reasoning") or last_reasoning
        for k, v in (resp.get("usage") or {}).items():
            if isinstance(v, int):
                total_usage[k] = total_usage.get(k, 0) + v

        # ---- native tool calls ------------------------------------------------
        calls = resp["tool_calls"]
        if calls:
            messages.append(msg)
            for call in calls:
                fn = call.get("function") or {}
                name = fn.get("name", "")
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = run_tool(name, args)
                entry = {"tool": name, "args": args,
                         "preview": _truncate(result.get("result", result), 600)}
                trace.append(entry)
                yield ("tool", entry)
                messages.append({
                    "role": "tool",
                    "tool_call_id": call.get("id", f"call_{len(trace)}"),
                    "name": name,
                    "content": _truncate(result),
                })
            continue

        # ---- fenced-action fallback -------------------------------------------
        content = resp["content"] or ""
        m = _TOOL_BLOCK.search(content)
        if m:
            try:
                action = json.loads(m.group(1))
                name, args = action.get("tool", ""), action.get("args") or {}
            except json.JSONDecodeError:
                name, args = "", {}
            if name in TOOLS:
                result = run_tool(name, args)
                entry = {"tool": name, "args": args,
                         "preview": _truncate(result.get("result", result), 600)}
                trace.append(entry)
                yield ("tool", entry)
                messages.append({"role": "assistant", "content": content})
                messages.append({
                    "role": "user",
                    "content": "TOOL RESULT " + _truncate(result)
                               + "\nAnswer the user now (or emit another ```tool block).",
                })
                continue
            if name:
                # Bad tool name in a valid block — tell the model which tools
                # exist so the next round self-corrects instead of looping.
                messages.append({"role": "assistant", "content": content})
                messages.append({
                    "role": "user",
                    "content": (f"Unknown tool '{name}'. Available: "
                                f"{', '.join(sorted(TOOLS))}. "
                                "Emit a corrected ```tool block or answer."),
                })
                continue

        # ---- plain answer ------------------------------------------------------
        return {
            "reply": content.strip() or "(empty answer)",
            "reasoning": last_reasoning,
            "tool_trace": trace,
            "rounds": _round + 1,
            "usage": total_usage,
            "finish_reason": resp["finish_reason"],
        }

    return {
        "reply": "I hit the tool-call round limit before finishing — try narrowing the question.",
        "reasoning": last_reasoning,
        "tool_trace": trace,
        "rounds": MAX_ROUNDS,
        "usage": total_usage,
        "finish_reason": "round_limit",
    }


def run_brief(cfg: AgentConfig, overlap_id: str) -> dict:
    """One-shot coordination brief for a single overlap (no user turn)."""
    detail = run_tool("get_overlap", {"overlap_id": overlap_id})
    # run_tool wraps results as {"ok":..., "result":{...}} — tool-level
    # errors live INSIDE result, not at the top level.
    rec = detail.get("result") or {}
    if "error" in rec:
        return {"error": rec["error"]}
    if not detail.get("ok") or not rec.get("project_a"):
        return {"error": f"could not load overlap '{overlap_id}'"}
    pa = run_tool("get_project", {"project_id": rec["project_a"]})
    pb = run_tool("get_project", {"project_id": rec["project_b"]})
    imp = run_tool("impact_estimate", {"overlap_id": overlap_id})
    prompt = (
        "Write a tight 4-6 sentence coordination brief for this overlap: what the two "
        "utilities could share (ROW, outage windows, crews, laydown yards), the tier and "
        "distance, the shared build window (or that dates are missing — say so), "
        "the estimated savings range if given (cite as rough planning figures), and one "
        "concrete next step (e.g. joint outage schedule). Use only this data:\n"
        f"OVERLAP: {_truncate(detail, 3000)}\n"
        f"PROJECT A: {_truncate(pa, 2000)}\n"
        f"PROJECT B: {_truncate(pb, 2000)}\n"
        f"IMPACT: {_truncate(imp, 2500)}"
    )
    resp = chat_completion(cfg, [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ])
    return {
        "overlap_id": overlap_id,
        "brief": (resp["content"] or "").strip(),
        "reasoning": resp.get("reasoning"),
        "usage": resp.get("usage") or {},
    }
