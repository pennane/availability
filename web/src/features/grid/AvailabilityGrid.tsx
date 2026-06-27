import { useMemo, useEffect, useCallback } from 'react'
import { GridCell } from './GridCell'
import { useGridInteraction } from './useGridInteraction'
import type { CellState, SlotEntry, GridColumn, CalendarDay } from './types'
import { generateSlotRows, buildCalendarWeeks, monthLabel } from '@/shared/grid/slots'

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

function toFullDatetime(date: string, time: string): string {
  return `${date}T${time}`
}

type DayCheckState = 'all-available' | 'all-if-needed' | 'mixed' | 'none'

function dayAriaChecked(state: DayCheckState): boolean | 'mixed' {
  if (state === 'all-available') return true
  if (state === 'none') return false
  return 'mixed'
}

const DAY_STATE_LABELS: Record<DayCheckState, string> = {
  'all-available': 'All available',
  'all-if-needed': 'All if needed',
  mixed: 'Partially selected',
  none: 'None selected',
}

export function AvailabilityGrid({
  columns,
  timeSlotConfig,
  entries,
  onChange,
}: Props) {
  const rows = useMemo(() => generateSlotRows(timeSlotConfig), [timeSlotConfig])
  const weeks = useMemo(() => buildCalendarWeeks(columns), [columns])
  const { getState, onPointerDown, onPointerEnter, onPointerUp, setSlotList, toggleDay } =
    useGridInteraction({ entries, onChange })

  const getDayState = useCallback(
    (eventDateId: string, date: string): DayCheckState => {
      const states = rows.map((row) => getState(eventDateId, toFullDatetime(date, row.datetime)))
      const filled = states.filter((s): s is Exclude<CellState, 'empty'> => s !== 'empty')
      if (filled.length === 0) return 'none'
      if (filled.length < states.length) return 'mixed'
      if (filled.every((s) => s === 'available')) return 'all-available'
      if (filled.every((s) => s === 'if-needed')) return 'all-if-needed'
      return 'mixed'
    },
    [rows, getState],
  )

  useEffect(() => {
    setSlotList(rows.map((row) => row.datetime))
  }, [rows, setSlotList])

  let prevDay: CalendarDay | undefined

  return (
    <div role="grid" aria-label="Availability grid" onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
      <div className="overflow-auto max-h-[70vh] border border-gray-300 rounded">
        <div className="flex">
          {/* Time labels column */}
          <div className="sticky left-0 z-20 bg-white flex-shrink-0 w-14">
            <div className="h-12 border-b border-gray-300" />
            {rows.map((row) => (
              <div
                key={row.slot}
                className="h-6 text-[10px] text-gray-500 text-right pr-1.5 flex items-center justify-end border-b border-gray-100"
              >
                {row.slot}
              </div>
            ))}
          </div>

          {/* Week groups */}
          {weeks.map((week) => (
            <div key={week.key} className="flex border-l-2 border-gray-300">
              {week.days.map((day) => {
                const ml = monthLabel(day, prevDay)
                prevDay = day

                if (!day.active) {
                  return (
                    <div key={day.date} className="min-w-10 flex-1">
                      <div className="h-12 border-b border-gray-300 text-center sticky top-0 bg-gray-50 z-10 flex flex-col justify-end pb-0.5">
                        {ml && (
                          <span className="text-[9px] text-gray-400 font-medium leading-none">{ml}</span>
                        )}
                        <span className="text-[10px] text-gray-300 leading-none">{day.weekday}</span>
                        <span className="text-xs text-gray-300 font-medium leading-tight">{day.dayNum}</span>
                      </div>
                      {rows.map((row) => (
                        <div
                          key={row.slot}
                          className="h-6 border-b border-r border-gray-100 bg-gray-50"
                        />
                      ))}
                    </div>
                  )
                }

                const dayState = getDayState(day.eventDateId!, day.date)
                return (
                  <div key={day.eventDateId} className="min-w-10 flex-1">
                    <div
                      role="checkbox"
                      aria-checked={dayAriaChecked(dayState)}
                      aria-label={`${day.weekday} ${day.dayNum} — ${DAY_STATE_LABELS[dayState]}`}
                      className="h-12 border-b border-gray-300 text-center sticky top-0 bg-white z-10 flex flex-col justify-end pb-0.5 cursor-pointer hover:bg-blue-50 transition-colors"
                      onClick={() => toggleDay(day.eventDateId!, day.date, 'available')}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        toggleDay(day.eventDateId!, day.date, 'if-needed')
                      }}
                    >
                      {ml && (
                        <span className="text-[9px] text-gray-400 font-medium leading-none">{ml}</span>
                      )}
                      <span className="text-[10px] text-gray-400 leading-none">{day.weekday}</span>
                      <span className="text-xs font-medium leading-tight">{day.dayNum}</span>
                    </div>
                    {rows.map((row, rowIndex) => {
                      const fullSlot = toFullDatetime(day.date, row.datetime)
                      return (
                        <GridCell
                          key={fullSlot}
                          state={getState(day.eventDateId!, fullSlot)}
                          rowIndex={rowIndex}
                          onPointerDown={(ri, ptype) => onPointerDown(day.eventDateId!, fullSlot, ri, ptype)}
                          onPointerEnter={(ri) => onPointerEnter(day.eventDateId!, fullSlot, ri)}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend — outside scroll container */}
      <div className="px-3 py-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 bg-green-400 rounded-sm" /> Available
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 bg-yellow-300 rounded-sm" /> If needed
        </span>
        <span className="hidden sm:inline">· Click / right-click</span>
        <span className="sm:hidden">· Tap to cycle</span>
        <span>· Drag to paint</span>
      </div>
    </div>
  )
}
