/**
 * Dark pill label rendered inside drei <Html> over the 3D map.
 * Non-interactive (pointer-events: none) so it never blocks pan/zoom.
 */
export function LabelChip({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="label-chip">
      <span className="label-chip-text">{text}</span>
      {sub ? <span className="label-chip-sub">{sub}</span> : null}
    </div>
  )
}
