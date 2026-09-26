import type { ReactNode } from 'react'

/**
 * md.tsx — dependency-free mini markdown renderer for agent replies.
 * Handles exactly what the model emits: **bold**, -/* bullets,
 * | pipe | tables |, ## headers, and plain paragraphs. Anything else
 * passes through as text — never trusts the model with raw HTML.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  // split on **bold** spans; odd indexes are bold
  const parts = text.split(/\*\*([^*]+)\*\*/g)
  return parts.map((p, i) =>
    i % 2 === 1 ? <strong key={`${keyBase}-b${i}`}>{p}</strong> : p,
  )
}

function isTableRow(line: string): boolean {
  const t = line.trim()
  return t.startsWith('|') && t.endsWith('|') && t.includes('|')
}

function isSepRow(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line.trim())
}

export function renderMarkdown(text: string): ReactNode[] {
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
              <tr>{header.map((c, j) => <th key={j}>{inline(c, `h${key}-${j}`)}</th>)}</tr>
            </thead>
          )}
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `c${key}-${ri}-${j}`)}</td>)}</tr>
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
          {inline(h[2], `h${key}`)}
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
          {items.map((it, j) => <li key={j}>{inline(it, `li${key}-${j}`)}</li>)}
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
        {inline(para.join(' '), `p${key}`)}
      </p>,
    )
  }
  return out
}
