/**
 * Shared formatting + parsing helpers for the detail cards AND the exported
 * HTML report — pure string in -> string out, no React, no DOM. Keeping them
 * here means the on-screen card and the downloaded file can never drift
 * apart on how a filed value is rendered.
 */

import type { ProjectProps } from './api'

/** Compact honest USD: $0, $400k, $1.2M */
export function fmtUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`
  return `$${v}`
}

export function fmtLonLat(p: [number, number]): string {
  return `${p[0].toFixed(5)}, ${p[1].toFixed(5)}`
}

/** snake_case filing enums -> readable words ("transmission_line" -> "transmission line") */
export function humanize(s: string | null | undefined): string {
  return (s ?? '').replace(/_/g, ' ').trim()
}

/** Filed build window — 'not filed' when the filing omits both years,
 * em-dash placeholder for a one-sided window. Never fabricates a year. */
export function buildWindow(
  start: number | null | undefined,
  end: number | null | undefined,
): string {
  if (start == null && end == null) return 'not filed'
  return `${start ?? '—'}–${end ?? '—'}`
}

export function yearsOf(p: ProjectProps | undefined): string {
  const s = p?.start_year
  const e = p?.end_year
  if (s == null && e == null) return 'years n/a'
  return `${s ?? '—'}–${e ?? '—'}`
}

export function voltageOf(p: ProjectProps | undefined): string {
  return p?.voltage_kv != null ? `${p.voltage_kv} kV` : 'voltage n/a'
}

/** Honest tooltip/label text for the filed location-confidence flag. */
export const CONFIDENCE_TITLE: Record<string, string> = {
  verified: 'verified — geometry traced from a filed map/GIS exhibit',
  endpoint_only: 'endpoint_only — endpoints filed; the path between is approximate',
  approximate: 'approximate — filing describes an area, not a surveyed route',
}

/**
 * HTML-escape filed text before it goes into a report/export string.
 * Filed names contain '&', '–', quotes — always escape, never trust.
 */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

export interface ParsedSource {
  /** leading http(s) URL if the filed source starts with one */
  url: string | null
  /** display domain (www stripped) — falls back to the raw URL */
  domain: string
  /** filing note verbatim, after the URL ("Project 12 of 54, ISD …") */
  note: string
  raw: string
}

/**
 * Provenance: filed sources are "url (note)" — the cards link the domain and
 * keep the filing note verbatim; the report does the same with real anchors.
 * One parser feeds both so they always agree.
 */
export function parseSource(source: string | null | undefined): ParsedSource {
  const raw = source ?? ''
  const m = raw.match(/^https?:\/\/\S+/)
  if (!m) return { url: null, domain: '', note: '', raw }
  const url = m[0]
  let domain = url
  try {
    domain = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    /* leave the raw URL as the link label */
  }
  return { url, domain, note: raw.slice(url.length).trim(), raw }
}

/** Filename-safe record id: "OV-0042 x" -> "OV-0042-x". */
export function safeFileName(id: string): string {
  const clean = id.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return clean || 'record'
}
