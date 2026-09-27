"""OpenAI-compatible chat client (tensormux default).

Reads AGENT_API_KEY / AGENT_BASE_URL / AGENT_MODEL from env (.env is
gitignored — the key must stay server-side). One narrow responsibility:
POST /chat/completions and normalize the response, including the
provider's optional `reasoning` field (thinking models).
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass

import requests


@dataclass(frozen=True)
class AgentConfig:
    api_key: str
    base_url: str
    model: str
    timeout_s: float = 90.0
    # thinking models burn thousands of tokens in the reasoning field
    # before content — a tight cap truncates them into empty answers.
    # Must stay BELOW the model's context window (glm-4-7-flash = 32k) —
    # the completion budget and the prompt share it. chat_completion
    # also clamps against the actual prompt size. AGENT_MAX_TOKENS
    # overrides.
    max_tokens: int = 16384
    temperature: float = 0.2


def load_config() -> AgentConfig | None:
    key = os.getenv("AGENT_API_KEY", "").strip()
    if not key:
        return None
    return AgentConfig(
        api_key=key,
        base_url=os.getenv("AGENT_BASE_URL", "https://api.tensormux.com/v1").rstrip("/"),
        model=os.getenv("AGENT_MODEL", "glm-4-7-flash"),
        max_tokens=_env_int("AGENT_MAX_TOKENS", 16384),
    )


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


class ChatError(RuntimeError):
    pass


def chat_completion(
    cfg: AgentConfig,
    messages: list[dict],
    tools: list[dict] | None = None,
) -> dict:
    """One /chat/completions round-trip -> normalized assistant message."""
    # The completion budget shares the model's context with the prompt —
    # glm-4-7-flash is 32768 total, and requesting max_tokens >= what the
    # prompt leaves free is a hard 400 upstream ("requested N output
    # tokens ... upper bound for 0 input tokens"). Estimate the prompt at
    # ~4 chars/token (+ tool specs) and clamp, keeping a floor so a fat
    # history can still answer.
    est_prompt = (
        sum(len(str(m.get("content") or "")) // 4
            + len(str(m.get("reasoning") or "")) // 4
            + len(str(m.get("tool_calls") or "")) // 4
            for m in messages)
        + (len(tools) * 120 if tools else 0)
        + 512
    )
    max_out = max(1024, min(cfg.max_tokens, 32768 - est_prompt))
    payload: dict = {
        "model": cfg.model,
        "messages": messages,
        "temperature": cfg.temperature,
        "max_tokens": max_out,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    # One retry on transient failures (429/5xx/conn reset) — keeps a flaky
    # shared endpoint from killing a 5-round tool chain on round 4.
    resp = None
    last_err: Exception | None = None
    for attempt in (0, 1):
        try:
            resp = requests.post(
                f"{cfg.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {cfg.api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=cfg.timeout_s,
            )
        except requests.RequestException as e:
            last_err = e
            if attempt == 0:
                time.sleep(1.5)
                continue
            raise ChatError(f"agent endpoint unreachable: {e}") from e
        if resp.status_code < 500 and resp.status_code != 429:
            break
        if attempt == 0:
            time.sleep(1.5)

    if resp is None:
        raise ChatError(f"agent endpoint unreachable: {last_err}")
    if resp.status_code != 200:
        raise ChatError(f"agent endpoint {resp.status_code}: {resp.text[:400]}")

    try:
        data = resp.json()
    except ValueError as e:
        # 200 with a non-JSON body (proxy HTML, truncated stream…) —
        # surface as a controlled ChatError, not an unhandled decode crash.
        raise ChatError(
            f"agent endpoint returned non-JSON body: {resp.text[:200]!r}"
        ) from e
    if not isinstance(data, dict):
        raise ChatError(
            f"agent endpoint returned non-object JSON: {str(data)[:200]!r}")
    choice = (data.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    return {
        "content": msg.get("content"),
        "reasoning": msg.get("reasoning"),  # thinking-model trace, if served
        "tool_calls": msg.get("tool_calls") or [],
        "finish_reason": choice.get("finish_reason"),
        "usage": data.get("usage") or {},
        "raw_message": msg,  # for the assistant-turn echo back into history
    }
