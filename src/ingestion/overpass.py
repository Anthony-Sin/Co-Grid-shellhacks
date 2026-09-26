#!/usr/bin/env python3
"""Shared Overpass API client for the OSM ingestion scripts.

Endpoint comes from env ``OVERPASS_URL`` (default the public
``overpass-api.de`` interpreter). POSTs the query via the ``data=`` form
param with a 300 s client timeout. On HTTP 429 / 5xx the request is
retried once after a backoff, against ``OVERPASS_FALLBACK_URL``
(default ``https://overpass.kumi.systems/api/interpreter``) when the
primary is the one that failed. Responses are validated — JSON must parse
and contain an ``elements`` key, and Overpass error ``remark`` fields are
treated as failures — before being handed to the caller.

This is a library module, not a standalone downloader. See:
    ./venv/bin/python -m src.ingestion.osm_power
    ./venv/bin/python -m src.ingestion.osm_places
    ./venv/bin/python -m src.ingestion.osm_borders
"""
from __future__ import annotations

import json
import os
import time

import requests

OVERPASS_URL = os.environ.get(
    "OVERPASS_URL", "https://overpass-api.de/api/interpreter"
)
FALLBACK_URL = os.environ.get(
    "OVERPASS_FALLBACK_URL", "https://overpass.kumi.systems/api/interpreter"
)
REQUEST_TIMEOUT_S = 300
RETRY_BACKOFF_S = 15
HEADERS = {"User-Agent": "co-grid-hackathon/0.1 (OSM data, research)"}


def _remark_is_error(remark: str) -> bool:
    """Detect Overpass 'remark' fields that indicate failure/timeout."""
    r = remark.lower()
    return "error" in r or "timed out" in r or "too many requests" in r


def post_overpass(query: str, label: str = "overpass") -> dict:
    """POST one Overpass QL query; return the validated response dict.

    Tries OVERPASS_URL first; on 429/5xx/connection/validation failure
    backs off and retries once on FALLBACK_URL. Raises RuntimeError if
    every attempt fails.
    """
    endpoints = [OVERPASS_URL]
    if FALLBACK_URL != OVERPASS_URL:
        endpoints.append(FALLBACK_URL)

    last = "no attempts"
    for attempt, url in enumerate(endpoints):
        if attempt:
            print(f"    {label}: backing off {RETRY_BACKOFF_S}s -> {url}")
            time.sleep(RETRY_BACKOFF_S)
        try:
            r = requests.post(
                url,
                data={"data": query},
                headers=HEADERS,
                timeout=REQUEST_TIMEOUT_S,
            )
        except requests.RequestException as exc:
            last = f"{url}: connection error: {exc}"
            print(f"    {label}: {last}")
            continue
        if r.status_code == 429 or r.status_code >= 500:
            last = f"{url}: HTTP {r.status_code}"
            print(f"    {label}: {last}")
            continue
        if r.status_code != 200:
            snippet = r.text[:300].replace("\n", " ")
            raise RuntimeError(
                f"{label}: {url} HTTP {r.status_code} (non-retryable): {snippet}"
            )
        try:
            data = r.json()
        except json.JSONDecodeError as exc:
            last = f"{url}: invalid JSON body: {exc}"
            print(f"    {label}: {last}")
            continue
        remark = str(data.get("remark", ""))
        if remark and _remark_is_error(remark):
            last = f"{url}: overpass remark: {remark[:160]}"
            print(f"    {label}: {last}")
            continue
        if "elements" not in data:
            last = f"{url}: response has no 'elements' key"
            print(f"    {label}: {last}")
            continue
        return data
    raise RuntimeError(f"{label}: query failed on all endpoints: {last}")


def merge_elements(parts: list[dict]) -> dict:
    """Merge several Overpass responses, deduping by (type, id)."""
    merged: dict[tuple[str, int], dict] = {}
    for data in parts:
        for el in data.get("elements", []):
            merged[(el.get("type"), el.get("id"))] = el
    return {
        "version": 0.6,
        "generator": "Overpass API (merged sub-queries)",
        "elements": list(merged.values()),
    }


def split_bbox(bbox: tuple[float, float, float, float], n: int = 2) -> list:
    """Split an (s, w, n, e) Overpass bbox into an n x n grid of tiles."""
    s, w, north, e = bbox
    lat_step = (north - s) / n
    lon_step = (e - w) / n
    tiles = []
    for i in range(n):
        for j in range(n):
            tiles.append(
                (
                    s + i * lat_step,
                    w + j * lon_step,
                    s + (i + 1) * lat_step,
                    w + (j + 1) * lon_step,
                )
            )
    return tiles
