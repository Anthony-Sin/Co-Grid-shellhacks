import { useMemo } from 'react'
import { humanize } from '../../lib/format'
import { OverlapDetail } from './OverlapDetail'
import { ProjectDetail } from './ProjectDetail'
import { useOverlaps, useProjects } from '../hooks/useApiData'
import { useAppStore } from '../../state/store'

/**
 * AgentRailSelection — the rail's selection region, mounted by AgentBar.
 * Two stacked pieces, both driven by the store's mutually-exclusive
 * selectedOverlapId/selectedProjectId:
 *
 *   1. .agent-detail — hosts the real OverlapDetail/ProjectDetail cards
 *      (only while a selection exists; the region scrolls, not the card)
 *   2. .agent-sel — a pinned one-line context header naming the record
 *      the way an agent message would ("OV-0019 · MEAG × GTC · touching"),
 *      so a follow-up question is always visibly anchored to a record
 */
export function AgentRailSelection() {
  const selectedOverlapId = useAppStore((s) => s.selectedOverlapId)
  const selectedProjectId = useAppStore((s) => s.selectedProjectId)
  const overlaps = useOverlaps()
  const projects = useProjects()

  const selLabel = useMemo(() => {
    if (selectedOverlapId) {
      const o = overlaps.data?.overlaps.find(
        (x) => x.overlap_id === selectedOverlapId,
      )
      return o
        ? `${o.overlap_id} · ${o.utilities.join(' × ')} · ${humanize(o.tier_label)}`
        : selectedOverlapId
    }
    if (selectedProjectId) {
      const p = projects.data?.features.find(
        (f) => f.properties.project_id === selectedProjectId,
      )?.properties
      return p ? `${p.name} · ${p.utility}` : selectedProjectId
    }
    return null
  }, [selectedOverlapId, selectedProjectId, overlaps.data, projects.data])

  return (
    <>
      {/* the store keeps the two cards exclusive so at most one renders */}
      {(selectedOverlapId || selectedProjectId) && (
        <div className="agent-detail">
          <OverlapDetail />
          <ProjectDetail />
        </div>
      )}
      {selLabel && (
        <div className="agent-sel" title={selLabel}>
          <span className="agent-sel-tag">selected</span>
          <span className="agent-sel-name mono">{selLabel}</span>
        </div>
      )}
    </>
  )
}
