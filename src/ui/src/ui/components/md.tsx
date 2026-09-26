import type { ReactNode } from 'react'

/**
 * md.tsx — dependency-free mini markdown renderer for agent replies.
 * Handles exactly what the model emits: **bold**, -/* bullets,
 * | pipe | tables |, ## headers, and plain paragraphs. Anything else
 * passes through as text — never trusts the model with raw HTML.
 *
 * `onSelect` turns overlap references into live chips: a deep-link
 * token (/?scene=X&select=OV-NNNN…) jumps scene + selects, a bare
 * OV-NNNN id selects in the current scene.
 */

export type OverlapSelectFn = (overlapId: string, scene?: string) => void

const TOKEN_RE =
  /(\*\*(OV-\d{3,})\*\*|\/?\?scene=(savannah|augusta|state)&select=(OV-\d+)[^ )\]]*|\bOV-\d{3,}\b)/g

function inline(text: string, keyBase: string,
                onSelect?: OverlapSelectFn): ReactNode[] {
  const parts = text.split(TOKEN_RE)
  const out: ReactNode[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p == null || p === '') continue
    // split interleaves 4 capture groups:
    // [text, full, boldOV, scene, linkOV, text, ...]
    if (i % 5 === 1) {
      const oid = parts[i + 1] ?? parts[i + 3] ?? p
      const scene = parts[i + 2]
      out.push(
        <button
          key={`${keyBase}-ov${i}`}
          type="button"
          className="md-ovlink mono"
          title={scene ? `jump to ${scene} scene + select ${oid}` : `select ${oid}`}
          onClick={() => onSelect?.(oid, scene || undefined)}
        >
          {oid}
        </button>,
      )
      continue
    }
    if (i % 5 >= 2) continue // consumed capture groups
    // plain text — bold-split
    const subs = p.split(/\*\*([^*]+)\*\*/g)
    subs.forEach((s, j) => {
      if (s === '') return
      out.push(
        j % 2 === 1
          ? <strong key={`${keyBase}-b${i}-${j}`}>{s}</strong>
          : <span key={`${keyBase}-t${i}-${j}`}>{s}</span>,
      )
    })
  }
  return out
}

function isTableRow(line: string): boolean {
  const t = line.trim()
  return t.startsWith('|') && t.endsWith('|') && t.includes('|')
}

function isSepRow(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line.trim())
}

export function renderMarkdown(text: string,
                               onSelect?: OverlapSelectFn): ReactNode[] {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // table block
    if (isTableRow(line)) {
      const rows: string[][] = []
      let header: string[] | null = null
      while (i < lines.length && isTableRow(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split('|').map((c) => c.trim())
        if (isSepRow(lines[i])) {
          header = rows.pop() ?? null // previous row was the header
        } else {
          rows.push(cells)
        }
        i++
      }
      const body = header ? rows : rows
      out.push(
        <table key={`t${key++}`} className="md-table">
          {header && (
            <thead>
              <tr>{header.map((c, j) => <th key={j}>{inline(c, `h${key}-${j}`, onSelect)}</th>)}</tr>
            </thead>
          )}
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `c${key}-${ri}-${j}`, onSelect)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      )
      continue
    }

    // heading
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      out.push(
        <div key={`h${key++}`} className={`md-h md-h${h[1].length}`}>
          {inline(h[2], `h${key}`, onSelect)}
        </div>,
      )
      i++
      continue
    }

    // bullet list (consecutive - / * / numbered lines)
    if (/^\s*([-*•]|\d+\.)\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+\.)\s+/, ''))
        i++
      }
      out.push(
        <ul key={`l${key++}`} className="md-list">
          {items.map((it, j) => <li key={j}>{inline(it, `li${key}-${j}`, onSelect)}</li>)}
        </ul>,
      )
      continue
    }

    // blank line -> paragraph break (skip)
    if (!line.trim()) {
      i++
      continue
    }

    // plain paragraph (merge consecutive non-empty lines)
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isTableRow(lines[i]) &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*([-*•]|\d+\.)\s+/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    out.push(
      <p key={`p${key++}`} className="md-p">
        {inline(para.join(' '), `p${key}`, onSelect)}
      </p>,
    )
  }
  return out
}
