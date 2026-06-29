import type { ReactNode } from 'react'
import type { GridRow, CalendarDay, CalendarWeek } from '@/features/grid/types'
import { monthLabel } from './slots'

type WeekColumnsProps = {
  week: CalendarWeek
  rows: GridRow[]
  prevDayRef: { current: CalendarDay | undefined }
  locale: string
  renderHeader: (day: CalendarDay, ml: string | null) => ReactNode
  renderCell: (day: CalendarDay, row: GridRow, rowIndex: number) => ReactNode
}

export function WeekColumns({
  week,
  rows,
  prevDayRef,
  locale,
  renderHeader,
  renderCell,
}: WeekColumnsProps) {
  return (
    <div className="flex flex-1 border-l-2 border-grid-border-strong">
      {week.days.map((day) => {
        const ml = monthLabel(day, prevDayRef.current, locale)
        prevDayRef.current = day

        if (!day.active) {
          return (
            <div key={day.date} className="min-w-10 flex-1">
              <div className="h-12 border-b border-grid-border text-center sticky top-0 bg-grid-muted z-10 flex flex-col justify-end pb-0.5">
                {ml && (
                  <span className="text-[9px] text-grid-text-ghost font-medium leading-none">{ml}</span>
                )}
                <span className="text-[10px] text-grid-text-ghost leading-none">{day.weekday}</span>
                <span className="text-xs text-grid-text-ghost font-medium leading-tight">{day.dayNum}</span>
              </div>
              {rows.map((row) => (
                <div key={row.slot} className="h-6 border-b border-r border-grid-border bg-grid-muted" />
              ))}
            </div>
          )
        }

        return (
          <div key={day.eventDateId} className="min-w-10 flex-1">
            {renderHeader(day, ml)}
            {rows.map((row, rowIndex) => renderCell(day, row, rowIndex))}
          </div>
        )
      })}
    </div>
  )
}
