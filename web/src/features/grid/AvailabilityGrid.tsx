import { useMemo } from 'react'
import { GridCell } from './GridCell'
import { useGridInteraction } from './useGridInteraction'
import type { SlotEntry, GridColumn, GridRow } from './types'

type TimeSlotConfig = {
  durationMinutes: number
  rangeStart: string
  rangeEnd: string
}

type Props = {
  columns: GridColumn[]
  timeSlotConfig: TimeSlotConfig
  entries: SlotEntry[]
  onChange: (entries: SlotEntry[]) => void
}

function generateSlotRows(config: TimeSlotConfig): GridRow[] {
  const rows: GridRow[] = []
  const [startH, startM] = config.rangeStart.split(':').map(Number)
  const [endH, endM] = config.rangeEnd.split(':').map(Number)
  const startMinutes = startH * 60 + startM
  let endMinutes = endH * 60 + endM
  if (endMinutes <= startMinutes) endMinutes += 24 * 60 // midnight wrap

  for (let m = startMinutes; m < endMinutes; m += config.durationMinutes) {
    const h = Math.floor((m % (24 * 60)) / 60)
    const min = m % 60
    const label = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
    rows.push({ slot: label, datetime: label })
  }
  return rows
}

function toFullDatetime(date: string, time: string): string {
  return `${date}T${time}`
}

export function AvailabilityGrid({
  columns,
  timeSlotConfig,
  entries,
  onChange,
}: Props) {
  const rows = useMemo(() => generateSlotRows(timeSlotConfig), [timeSlotConfig])
  const { getState, onPointerDown, onPointerEnter, onPointerUp } =
    useGridInteraction({ entries, onChange })

  return (
    <div
      role="grid"
      aria-label="Availability grid"
      className="overflow-x-auto"
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <div
        className="inline-grid"
        style={{
          gridTemplateColumns: `4rem repeat(${columns.length}, minmax(3rem, 1fr))`,
        }}
      >
        {/* Header row */}
        <div />
        {columns.map((col) => (
          <div
            key={col.eventDateId}
            role="columnheader"
            className="text-center text-xs font-medium p-1 truncate"
          >
            {col.date}
          </div>
        ))}

        {/* Data rows */}
        {rows.map((row) => (
          <div key={row.slot} role="row" className="contents">
            <div
              role="rowheader"
              className="text-xs text-gray-500 text-right pr-2 flex items-center justify-end"
            >
              {row.slot}
            </div>
            {columns.map((col) => {
              const fullSlot = toFullDatetime(col.date, row.datetime)
              return (
                <GridCell
                  key={`${col.eventDateId}-${row.slot}`}
                  state={getState(col.eventDateId, fullSlot)}
                  onPointerDown={() => onPointerDown(col.eventDateId, fullSlot)}
                  onPointerEnter={() =>
                    onPointerEnter(col.eventDateId, fullSlot)
                  }
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
