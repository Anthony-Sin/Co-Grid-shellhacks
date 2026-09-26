"""Agent routes — mounted by src/api/main.py as an APIRouter.

  GET  /api/agent/health            -> configured?, model, tool count
  POST /api/agent/chat              -> {reply, reasoning, tool_trace, usage}
  GET  /api/agent/brief/{overlap_id}-> generated coordination brief

The key stays server-side; the frontend only sees replies + traces.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .client import ChatError, load_config
from .engine import MAX_ROUNDS, run_brief, run_chat
from .tools import TOOLS

router = APIRouter(prefix="/api/agent", tags=["agent"])

MAX_MESSAGES = 40
MAX_CONTENT_CHARS = 8000


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
def chat(req: ChatRequest) -> dict[str, Any]:
    cfg = _config_or_503()
    history = []
    for m in req.messages:
        if m.role not in ("user", "assistant"):
            continue  # only the server writes system/tool messages
        history.append({"role": m.role, "content": m.content[:MAX_CONTENT_CHARS]})
    if not history or history[-1]["role"] != "user":
        raise HTTPException(400, "last message must be a user message")

    if req.overlap_id:
        history[-1]["content"] += f"\n\n[context: user selected {req.overlap_id}]"

    try:
        return run_chat(cfg, history)
    except ChatError as e:
        raise HTTPException(502, str(e)) from e


@router.get("/brief/{overlap_id}")
def brief(overlap_id: str) -> dict[str, Any]:
    cfg = _config_or_503()
    try:
        out = run_brief(cfg, overlap_id)
    except ChatError as e:
        raise HTTPException(502, str(e)) from e
    if "error" in out:
        raise HTTPException(404, out["error"])
    return out
