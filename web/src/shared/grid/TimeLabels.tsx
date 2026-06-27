import type { GridRow } from '@/features/grid/types'

export function TimeLabels({ rows }: { rows: GridRow[] }) {
  return (
    <div className="sticky left-0 z-20 bg-grid-surface flex-shrink-0 w-10 sm:w-14">
      <div className="h-12 border-b border-grid-border-strong" />
      {rows.map((row) => (
        <div
          key={row.slot}
          className="h-6 text-[10px] text-grid-text-muted text-right pr-1.5 flex items-center justify-end border-b border-grid-border"
        >
          {row.slot}
        </div>
      ))}
    </div>
  )
}
