"""Agent routes — mounted by src/api/main.py as an APIRouter.

  GET  /api/agent/health            -> configured?, model, tool count
  POST /api/agent/chat              -> {reply, reasoning, tool_trace, usage}
  POST /api/agent/chat/stream       -> SSE: tool events as they run + final
  GET  /api/agent/brief/{overlap_id}-> generated coordination brief

The key stays server-side; the frontend only sees replies + traces.
"""
from __future__ import annotations

import json
import time
from collections import defaultdict, deque
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .client import ChatError, load_config
from .engine import MAX_ROUNDS, iter_chat, run_brief, run_chat
from .tools import TOOLS

router = APIRouter(prefix="/api/agent", tags=["agent"])

MAX_MESSAGES = 40
MAX_CONTENT_CHARS = 8000

# cheap in-process rate limiting: each paid call burns provider tokens.
_RATE_WINDOW_S = 60.0
_RATE_LIMIT = 20          # paid calls per IP per minute
_MAX_TRACKED_IPS = 2000   # bound memory — a defaultdict of deques grows forever
_calls: dict[str, deque] = defaultdict(deque)


def _rate_limit(req: Request) -> None:
    ip = req.client.host if req.client else "?"
    now = time.monotonic()
    if ip not in _calls and len(_calls) >= _MAX_TRACKED_IPS:
        # evict the stalest buckets first (an attacker rotating IPs can't
        # grow the map past the cap; legit IPs re-register on next call)
        stale = [k for k, q in _calls.items()
                 if not q or now - q[-1] > _RATE_WINDOW_S]
        for k in stale:
            del _calls[k]
        if len(_calls) >= _MAX_TRACKED_IPS:
            _calls.clear()  # pathological flood — start over
    q = _calls[ip]
    while q and now - q[0] > _RATE_WINDOW_S:
        q.popleft()
    if len(q) >= _RATE_LIMIT:
        raise HTTPException(429, "rate limit — try again in a moment")
    q.append(now)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1, max_length=MAX_MESSAGES)
    overlap_id: str | None = None  # optional selection context


def _config_or_503():
    cfg = load_config()
    if cfg is None:
        raise HTTPException(
            503,
            "agent not configured — set AGENT_API_KEY/AGENT_BASE_URL/AGENT_MODEL in .env",
        )
    return cfg


def _selection_context(overlap_id: str | None) -> str:
    """Inject the selected overlap's REAL record fields as context — not
    just the id — so the model is grounded even before its first tool call."""
    if not overlap_id:
        return ""
    from .tools import run_tool
    res = run_tool("get_overlap", {"overlap_id": overlap_id})
    rec = res.get("result") or {}
    if "error" in rec:
        return f"\n\n[context: user selected {overlap_id} — record not found]"
    keep = {k: rec.get(k) for k in (
        "overlap_id", "project_a", "project_b", "utilities", "tier",
        "tier_label", "min_distance_km", "timeline_overlap",
        "timeline_adjacent", "shared_window", "adjacent_window", "zone",
    )}
    return f"\n\n[context: user selected {json.dumps(keep)}]"


def _history_or_400(req: ChatRequest) -> list[dict]:
    history = []
    for m in req.messages:
        if m.role not in ("user", "assistant"):
            continue  # only the server writes system/tool messages
        history.append({"role": m.role, "content": m.content[:MAX_CONTENT_CHARS]})
    if not history or history[-1]["role"] != "user":
        raise HTTPException(400, "last message must be a user message")
    history[-1]["content"] += _selection_context(req.overlap_id)
    return history


@router.get("/health")
def health() -> dict:
    cfg = load_config()
    return {
        "configured": cfg is not None,
        "model": cfg.model if cfg else None,
        "tools": sorted(TOOLS.keys()),
        "max_rounds": MAX_ROUNDS,
    }


@router.post("/chat")
def chat(req: ChatRequest, request: Request) -> dict[str, Any]:
    cfg = _config_or_503()
    _rate_limit(request)
    history = _history_or_400(req)

    try:
        return run_chat(cfg, history)
    except ChatError as e:
        raise HTTPException(502, str(e)) from e


def _sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()


@router.post("/chat/stream")
def chat_stream(req: ChatRequest, request: Request):
    """SSE version of /chat: emits `tool` events as each call completes so
    the UI can show live progress during multi-round chains, then a `final`
    event with the same payload shape as /chat, then `done`."""
    cfg = _config_or_503()
    _rate_limit(request)
    history = _history_or_400(req)

    def events():
        try:
            gen = iter_chat(cfg, history)
            while True:
                try:
                    kind, payload = next(gen)
                except StopIteration as stop:
                    yield _sse("final", stop.value)
                    yield _sse("done", {})
                    return
                yield _sse(kind, payload)
        except ChatError as e:
            yield _sse("error", {"message": str(e)})
            yield _sse("done", {})
        except Exception as e:  # noqa: BLE001 — any mid-stream failure must
            # terminate with an error event, not a hung/aborted stream that
            # forces the client into a full paid /chat retry.
            yield _sse("error", {"message": f"stream failed: {type(e).__name__}"})
            yield _sse("done", {})

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


@router.get("/brief/{overlap_id}")
def brief(overlap_id: str, request: Request) -> dict[str, Any]:
    cfg = _config_or_503()
    _rate_limit(request)
    try:
        out = run_brief(cfg, overlap_id)
    except ChatError as e:
        raise HTTPException(502, str(e)) from e
    if "error" in out:
        raise HTTPException(404, out["error"])
    return out
