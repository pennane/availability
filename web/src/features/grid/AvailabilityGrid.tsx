import { useMemo, useEffect, useCallback, useRef } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { GridCell } from './GridCell'
import { useGridInteraction } from './useGridInteraction'
import type { CellState, SlotEntry, GridColumn, CalendarDay, CalendarWeek } from './types'
import { generateSlotRows, buildCalendarWeeks, monthLabel, weekRangeLabel, toFullDatetime } from '@/shared/grid/slots'
import { TimeLabels } from '@/shared/grid/TimeLabels'

export { buildCalendarWeeks, weekRangeLabel }
export type { CalendarWeek }

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
  onFlush?: () => void
  weekIndex: number
  onWeekIndexChange: (index: number) => void
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

const DAY_STATE_STYLES: Record<DayCheckState, { bg: string; text: string; sub: string }> = {
  'all-available': { bg: 'bg-green-100', text: 'text-green-900', sub: 'text-green-700' },
  'all-if-needed': { bg: 'bg-yellow-100', text: 'text-yellow-900', sub: 'text-yellow-700' },
  mixed: { bg: 'bg-grid-header-mixed-bg', text: 'text-grid-header-mixed-text', sub: 'text-grid-header-mixed-sub' },
  none: { bg: 'bg-grid-header-none-bg', text: 'text-grid-header-none-text', sub: 'text-grid-header-none-sub' },
}

type GridRow = { slot: string; datetime: string }

function WeekColumns({
  week,
  rows,
  prevDayRef,
  locale,
  getState,
  getDayState,
  toggleDay,
  onPointerDown,
  onFlush,
}: {
  week: CalendarWeek
  rows: GridRow[]
  prevDayRef: { current: CalendarDay | undefined }
  locale: string
  getState: (eventDateId: string, slot: string) => CellState
  getDayState: (eventDateId: string, date: string) => DayCheckState
  toggleDay: (eventDateId: string, date: string, targetState: 'available' | 'if-needed') => void
  onPointerDown: (eventDateId: string, slot: string, rowIndex: number, pointerType: string, clientX: number, clientY: number) => void
  onFlush?: () => void
}) {
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
                <div
                  key={row.slot}
                  className="h-6 border-b border-r border-grid-border bg-grid-muted"
                />
              ))}
            </div>
          )
        }

        const dayState = getDayState(day.eventDateId!, day.date)
        const styles = DAY_STATE_STYLES[dayState]
        return (
          <div key={day.eventDateId} className="min-w-10 flex-1">
            <div
              role="checkbox"
              aria-checked={dayAriaChecked(dayState)}
              aria-label={`${day.weekday} ${day.dayNum} — ${DAY_STATE_LABELS[dayState]}`}
              className={`h-12 border-b border-grid-border-strong text-center sticky top-0 ${styles.bg} z-10 flex flex-col justify-end pb-0.5 cursor-pointer hover:brightness-95 transition-all`}
              onClick={() => { toggleDay(day.eventDateId!, day.date, 'available'); onFlush?.() }}
              onContextMenu={(e) => {
                e.preventDefault()
                toggleDay(day.eventDateId!, day.date, 'if-needed')
                onFlush?.()
              }}
            >
              {ml && (
                <span className={`text-[9px] ${styles.sub} font-medium leading-none`}>{ml}</span>
              )}
              <span className={`text-[10px] ${styles.sub} leading-none`}>{day.weekday}</span>
              <span className={`text-xs font-medium leading-tight ${styles.text}`}>{day.dayNum}</span>
            </div>
            {rows.map((row, rowIndex) => {
              const fullSlot = toFullDatetime(day.date, row.datetime)
              return (
                <GridCell
                  key={fullSlot}
                  state={getState(day.eventDateId!, fullSlot)}
                  eventDateId={day.eventDateId!}
                  slot={fullSlot}
                  rowIndex={rowIndex}
                  onPointerDown={(ri, ptype, cx, cy) => onPointerDown(day.eventDateId!, fullSlot, ri, ptype, cx, cy)}
                />
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export function WeekMinimap({
  weeks,
  entries,
  currentIndex,
  onSelect,
}: {
  weeks: CalendarWeek[]
  entries: SlotEntry[]
  currentIndex: number
  onSelect: (index: number) => void
}) {
  const intl = useIntl()
  const weekScores = useMemo(() => {
    const availableDates = new Set(
      entries.filter((e) => e.state === 'available').map((e) => e.eventDateId),
    )
    const ifNeededDates = new Set(
      entries.filter((e) => e.state === 'if-needed').map((e) => e.eventDateId),
    )
    return weeks.map((week) => {
      const activeDays = week.days.filter((d) => d.active)
      if (activeDays.length === 0) return { fill: 0, kind: 'none' as const }
      let avail = 0
      let ifNeeded = 0
      for (const d of activeDays) {
        if (availableDates.has(d.eventDateId!)) avail++
        else if (ifNeededDates.has(d.eventDateId!)) ifNeeded++
      }
      const fill = (avail + ifNeeded) / activeDays.length
      const kind = avail > 0 ? ('available' as const) : ifNeeded > 0 ? ('if-needed' as const) : ('none' as const)
      return { fill, kind }
    })
  }, [weeks, entries])

  return (
    <div className="flex flex-wrap gap-1 py-2">
      {weeks.map((week, i) => {
        const { fill, kind } = weekScores[i]
        const barColor =
          fill === 0
            ? 'bg-gray-200'
            : kind === 'available'
              ? fill < 1
                ? 'bg-green-300'
                : 'bg-green-500'
              : fill < 1
                ? 'bg-yellow-200'
                : 'bg-yellow-400'
        return (
          <button
            key={week.key}
            onClick={() => onSelect(i)}
            className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded text-[10px] ring-1 ring-inset transition-colors cursor-pointer ${
              i === currentIndex
                ? 'ring-grid-minimap-active-ring bg-grid-minimap-active-bg text-grid-minimap-active-text'
                : 'ring-transparent text-grid-text-faint hover:bg-grid-empty-hover'
            }`}
            aria-label={`Week ${i + 1}`}
            aria-current={i === currentIndex ? 'true' : undefined}
          >
            <span>{weekRangeLabel(week, intl.locale)}</span>
            <span className={`block w-full h-1 rounded-full ${barColor}`} />
          </button>
        )
      })}
    </div>
  )
}

export function AvailabilityGrid({
  columns,
  timeSlotConfig,
  entries,
  onChange,
  onFlush,
  weekIndex,
  onWeekIndexChange,
}: Props) {
  const intl = useIntl()
  const rows = useMemo(() => generateSlotRows(timeSlotConfig), [timeSlotConfig])
  const weeks = useMemo(() => buildCalendarWeeks(columns, intl.locale), [columns, intl.locale])
  const { getState, onPointerDown, onPointerMove, onPointerUp, setSlotList, toggleDay } =
    useGridInteraction({ entries, onChange })
  const desktopScrollRef = useRef<HTMLDivElement>(null)

  const safeIndex = Math.min(weekIndex, Math.max(0, weeks.length - 1))
  const currentWeek = weeks[safeIndex] as CalendarWeek | undefined
  const hasPrev = safeIndex > 0
  const hasNext = safeIndex < weeks.length - 1

  useEffect(() => {
    const container = desktopScrollRef.current
    if (!container || container.clientWidth === 0) return
    const inner = container.firstElementChild as HTMLElement | null
    if (!inner) return
    const weekEl = inner.children[safeIndex + 1] as HTMLElement
    if (!weekEl) return
    const containerRect = container.getBoundingClientRect()
    const weekRect = weekEl.getBoundingClientRect()
    const labelWidth = (inner.children[0] as HTMLElement).offsetWidth
    container.scrollTo({
      left: container.scrollLeft + weekRect.left - containerRect.left - labelWidth,
      behavior: 'smooth',
    })
  }, [safeIndex])

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

  const handlePointerEnd = useCallback(() => {
    const wasDragging = onPointerUp()
    if (wasDragging) onFlush?.()
  }, [onPointerUp, onFlush])

  const prevDayRef = { current: undefined as CalendarDay | undefined }

  const sharedProps = {
    rows,
    prevDayRef,
    locale: intl.locale,
    getState,
    getDayState,
    toggleDay,
    onPointerDown,
    onFlush,
  }

  return (
    <div
      role="grid"
      aria-label="Availability grid"
      onPointerMove={onPointerMove}
      onPointerUp={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
    >
      {/* Desktop: all weeks */}
      <div className="hidden sm:block">
        <div ref={desktopScrollRef} className="overflow-auto max-h-[70vh] border border-grid-border-strong rounded">
          <div className="flex">
            <TimeLabels rows={rows} />
            {(() => { prevDayRef.current = undefined; return null })()}
            {weeks.map((week) => (
              <WeekColumns key={week.key} week={week} {...sharedProps} />
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: single week */}
      <div className="sm:hidden">
        <div className="flex items-center justify-between mb-1">
          <button
            onClick={() => onWeekIndexChange(safeIndex - 1)}
            disabled={!hasPrev}
            className="p-1.5 text-grid-text-muted hover:bg-grid-empty-hover rounded disabled:opacity-30"
            aria-label={intl.formatMessage({ id: 'grid.previousWeek', defaultMessage: 'Previous week' })}
          >
            &larr;
          </button>
          <span className="text-xs text-grid-text-muted font-medium">
            <FormattedMessage id="grid.weekOf" defaultMessage="Week {current} / {total}" values={{ current: safeIndex + 1, total: weeks.length }} />
          </span>
          <button
            onClick={() => onWeekIndexChange(safeIndex + 1)}
            disabled={!hasNext}
            className="p-1.5 text-grid-text-muted hover:bg-grid-empty-hover rounded disabled:opacity-30"
            aria-label={intl.formatMessage({ id: 'grid.nextWeek', defaultMessage: 'Next week' })}
          >
            &rarr;
          </button>
        </div>
        <div className="overflow-auto max-h-[70vh] border border-grid-border-strong rounded">
          <div className="flex">
            <TimeLabels rows={rows} />
            {(() => { prevDayRef.current = undefined; return null })()}
            {currentWeek && (
              <WeekColumns week={currentWeek} {...sharedProps} />
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="px-1 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-gray-400">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 bg-green-400 rounded-sm" /> <FormattedMessage id="grid.available" defaultMessage="Available" />
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 bg-yellow-300 rounded-sm" /> <FormattedMessage id="grid.ifNeeded" defaultMessage="If needed" />
        </span>
        <span className="hidden sm:inline">· <FormattedMessage id="grid.clickRightClick" defaultMessage="Click / right-click" /></span>
        <span className="sm:hidden">· <FormattedMessage id="grid.tapToCycle" defaultMessage="Tap to cycle" /></span>
        <span>· <FormattedMessage id="grid.dragToPaint" defaultMessage="Drag to paint" /></span>
      </div>
    </div>
  )
}
