import type { RefObject } from 'react'
import { HEAD_CELLS, SORT_LABELS, type SortKey } from './overlapSort'
import { OverlapRow, type ProjectMap } from './OverlapRow'
import type { OverlapRecord } from '../../lib/api'
import '../../styles/panel-table.css'

type Cls = string | false | null | undefined
const cx = (...c: Cls[]) => c.filter(Boolean).join(' ')

export interface OverlapTableProps {
  /** the DOM-capped display order (engine order or the active re-sort) */
  shown: OverlapRecord[]
  /** filtered-set size (uncapped) + the dataset total for the footer */
  filteredCount: number
  totalCount: number
  sort: SortKey
  onSort: (key: SortKey) => void
  /** overlap_id → engine rank (# column shows rank, not list position) */
  rankById: Map<string, number>
  projectById: ProjectMap
  selectedOverlapId: string | null
  hoveredOverlapId: string | null
  onHover: (id: string | null) => void
  /** row click — toggles selection via selectOverlapInScene */
  onToggle: (o: OverlapRecord) => void
  /** shared with OverlapPanel's keyboard nav + scroll-into-view */
  listRef: RefObject<HTMLUListElement | null>
}

/**
 * The dense ranked table: a sticky one-line column header (sortable cells
 * for rank / km / window / score) over single-line OverlapRows, then a
 * "showing N of M" footer + the keyboard hint. Rows brush the map on
 * hover/focus and toggle selection on click.
 */
export function OverlapTable({
  shown, filteredCount, totalCount, sort, onSort,
  rankById, projectById, selectedOverlapId, hoveredOverlapId,
  onHover, onToggle, listRef,
}: OverlapTableProps) {
  return (
    <>
      <div className="ovr-head">
        {HEAD_CELLS.map((c) =>
          c.sort ? (
            <button key={c.key} type="button"
              className={cx('ovr-h', c.right && 'ovr-h--r', sort === c.sort && 'is-active')}
              title={c.hint} onClick={() => onSort(c.sort as SortKey)}>
              {c.label}{sort === c.sort ? ' ▾' : ''}
            </button>
          ) : (
            <span key={c.key}
              className={cx('ovr-h', 'ovr-h--static', c.right && 'ovr-h--r')}
              title={c.hint}>
              {c.label}
            </span>
          ),
        )}
      </div>

      <ul className="overlap-list ovl-dense" ref={listRef}>
        {shown.map((o) => (
          <OverlapRow key={o.overlap_id} overlap={o} projectById={projectById}
            rank={rankById.get(o.overlap_id) ?? 0}
            selected={selectedOverlapId === o.overlap_id}
            hovered={hoveredOverlapId === o.overlap_id}
            onHover={onHover}
            onSelect={() => onToggle(o)} />
        ))}
      </ul>

      <div className="ovr-foot">
        <span className="mono">
          showing {shown.length.toLocaleString('en-US')} of {filteredCount.toLocaleString('en-US')}
          {filteredCount !== totalCount && ` · ${totalCount.toLocaleString('en-US')} total`}
          {sort !== 'rank' && ` · by ${SORT_LABELS[sort]}`}
        </span>
        <span className="ovr-foot-keys mono" title="keyboard: j/k move · enter select · esc back">
          j/k · enter · esc
        </span>
      </div>
    </>
  )
}
