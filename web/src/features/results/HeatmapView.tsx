import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import type { GridColumn, GridRow, CalendarDay, CalendarWeek } from '@/features/grid/types'
import { buildCalendarWeeks, monthLabel } from '@/shared/grid/slots'

type ParticipantAvailability = {
  id: string
  name: string
  availability: Array<{ kind: string; eventDateId: string; slot: string }>
}

type Props = {
  columns: GridColumn[]
  rows: GridRow[]
  participants: ParticipantAvailability[]
  namesVisible: boolean
  weekIndex: number
}

function toFullDatetime(date: string, time: string): string {
  return `${date}T${time}`
}

function heatColor(availableRatio: number, ifNeededRatio: number): string {
  const total = availableRatio + ifNeededRatio
  if (total === 0) return 'bg-grid-empty'
  if (availableRatio === 0) {
    if (ifNeededRatio < 0.5) return 'bg-green-50'
    return 'bg-green-100'
  }
  if (availableRatio < 0.25) return 'bg-green-100'
  if (availableRatio < 0.5) return 'bg-green-200'
  if (availableRatio < 0.75) return 'bg-green-300'
  return 'bg-green-500'
}

type SlotDetail = {
  available: string[]
  ifNeeded: string[]
  total: number
}

type PopoverState = {
  eventDateId: string
  slot: string
  rect: DOMRect
} | null

function SlotPopover({
  state,
  detail,
  total,
  namesVisible,
  onClose,
  intl,
}: {
  state: NonNullable<PopoverState>
  detail: SlotDetail
  total: number
  namesVisible: boolean
  intl: ReturnType<typeof useIntl>
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const { rect } = state
    const vw = window.innerWidth
    const vh = window.innerHeight

    const popoverWidth = el.offsetWidth
    const popoverHeight = el.offsetHeight

    let top = rect.bottom + 4
    let left = rect.left + rect.width / 2 - popoverWidth / 2

    if (top + popoverHeight > vh - 8) {
      top = rect.top - popoverHeight - 4
    }
    if (left < 8) left = 8
    if (left + popoverWidth > vw - 8) left = vw - popoverWidth - 8

    el.style.top = `${top}px`
    el.style.left = `${left}px`
  }, [state])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const dateStr = intl.formatDate(new Date(state.slot.split('T')[0] + 'T12:00:00'), {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })

  return (
    <div
      ref={ref}
      role="tooltip"
      className="fixed z-50 bg-grid-surface border border-grid-border-strong rounded-lg shadow-lg p-3 text-sm max-w-56"
    >
      <div className="font-medium mb-1 text-xs text-gray-500">
        {state.slot.split('T')[1]} · {dateStr}
      </div>
      {namesVisible ? (
        <>
          {detail.available.length > 0 && (
            <div className="mb-0.5">
              <span className="text-green-600 font-medium"><FormattedMessage id="heatmap.availableLabel" defaultMessage="Available:" /></span>{' '}
              {detail.available.join(', ')}
            </div>
          )}
          {detail.ifNeeded.length > 0 && (
            <div className="mb-0.5">
              <span className="text-yellow-600 font-medium"><FormattedMessage id="heatmap.ifNeededLabel" defaultMessage="If needed:" /></span>{' '}
              {detail.ifNeeded.join(', ')}
            </div>
          )}
          {detail.available.length === 0 && detail.ifNeeded.length === 0 && (
            <div className="text-gray-400"><FormattedMessage id="heatmap.noOneAvailable" defaultMessage="No one available" /></div>
          )}
        </>
      ) : (
        <div>
          <FormattedMessage id="heatmap.respondedCount" defaultMessage="{count} / {total} responded" values={{ count: detail.available.length + detail.ifNeeded.length, total }} />
        </div>
      )}
    </div>
  )
}

function HeatWeekColumns({
  week,
  rows,
  slotMap,
  total,
  popover,
  prevDayRef,
  locale,
  onCellClick,
}: {
  week: CalendarWeek
  rows: GridRow[]
  slotMap: Map<string, SlotDetail>
  total: number
  popover: PopoverState
  prevDayRef: { current: CalendarDay | undefined }
  locale: string
  onCellClick: (e: React.MouseEvent, eventDateId: string, slot: string) => void
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
                <div key={row.slot} className="h-6 border-b border-r border-grid-border bg-grid-muted" />
              ))}
            </div>
          )
        }

        return (
          <div key={day.eventDateId} className="min-w-10 flex-1">
            <div className="h-12 border-b border-grid-border-strong text-center sticky top-0 bg-grid-surface z-10 flex flex-col justify-end pb-0.5">
              {ml && (
                <span className="text-[9px] text-grid-text-faint font-medium leading-none">{ml}</span>
              )}
              <span className="text-[10px] text-grid-text-faint leading-none">{day.weekday}</span>
              <span className="text-xs font-medium leading-tight">{day.dayNum}</span>
            </div>
            {rows.map((row) => {
              const fullSlot = toFullDatetime(day.date, row.datetime)
              const key = `${day.eventDateId}:${fullSlot}`
              const detail = slotMap.get(key)
              const availCount = detail?.available.length ?? 0
              const ifNeededCount = detail?.ifNeeded.length ?? 0
              const count = availCount + ifNeededCount
              const availRatio = total > 0 ? availCount / total : 0
              const ifNeededRatio = total > 0 ? ifNeededCount / total : 0
              const isSelected =
                popover?.eventDateId === day.eventDateId &&
                popover?.slot === fullSlot
              return (
                <div
                  key={fullSlot}
                  className={`h-6 border-b border-r border-grid-border cursor-pointer flex items-center justify-center text-[9px] font-medium ${heatColor(availRatio, ifNeededRatio)} ${isSelected ? 'ring-2 ring-inset ring-blue-500' : ''}`}
                  onClick={(e) => onCellClick(e, day.eventDateId!, fullSlot)}
                >
                  {count > 0 && (
                    <span className={availRatio >= 0.75 ? 'text-white' : 'text-gray-700'}>
                      {count}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function TimeLabels({ rows }: { rows: GridRow[] }) {
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

export function HeatmapView({ columns, rows, participants, namesVisible, weekIndex }: Props) {
  const intl = useIntl()
  const [popover, setPopover] = useState<PopoverState>(null)
  const weeks = useMemo(() => buildCalendarWeeks(columns, intl.locale), [columns, intl.locale])
  const total = participants.length
  const safeIndex = Math.min(weekIndex, Math.max(0, weeks.length - 1))
  const currentWeek = weeks[safeIndex] as CalendarWeek | undefined

  const slotMap = useMemo(() => {
    const map = new Map<string, SlotDetail>()
    for (const col of columns) {
      for (const row of rows) {
        const key = `${col.eventDateId}:${toFullDatetime(col.date, row.datetime)}`
        map.set(key, { available: [], ifNeeded: [], total })
      }
    }
    for (const p of participants) {
      for (const a of p.availability) {
        const key = `${a.eventDateId}:${a.slot}`
        const detail = map.get(key)
        if (!detail) continue
        if (a.kind === 'available') detail.available.push(p.name)
        else if (a.kind === 'if-needed') detail.ifNeeded.push(p.name)
      }
    }
    return map
  }, [columns, rows, participants, total])

  const handleCellClick = useCallback(
    (e: React.MouseEvent, eventDateId: string, slot: string) => {
      if (popover?.eventDateId === eventDateId && popover?.slot === slot) {
        setPopover(null)
        return
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setPopover({ eventDateId, slot, rect })
    },
    [popover],
  )

  const closePopover = useCallback(() => setPopover(null), [])

  const popoverDetail = popover
    ? slotMap.get(`${popover.eventDateId}:${popover.slot}`)
    : null

  if (total === 0) {
    return <p className="text-gray-500 text-sm"><FormattedMessage id="event.noResponses" defaultMessage="No responses yet." /></p>
  }

  const prevDayRef = { current: undefined as CalendarDay | undefined }

  const sharedProps = {
    rows,
    slotMap,
    total,
    popover,
    prevDayRef,
    locale: intl.locale,
    onCellClick: handleCellClick,
  }

  return (
    <div>
      {/* Desktop: all weeks */}
      <div className="hidden sm:block">
        <div className="overflow-auto max-h-[70vh] border border-grid-border-strong rounded">
          <div className="flex">
            <TimeLabels rows={rows} />
            {(() => { prevDayRef.current = undefined; return null })()}
            {weeks.map((week) => (
              <HeatWeekColumns key={week.key} week={week} {...sharedProps} />
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: single week */}
      <div className="sm:hidden">
        <div className="overflow-auto max-h-[70vh] border border-grid-border-strong rounded">
          <div className="flex">
            <TimeLabels rows={rows} />
            {(() => { prevDayRef.current = undefined; return null })()}
            {currentWeek && (
              <HeatWeekColumns week={currentWeek} {...sharedProps} />
            )}
          </div>
        </div>
      </div>

      {popover && popoverDetail && (
        <SlotPopover
          state={popover}
          detail={popoverDetail}
          total={total}
          namesVisible={namesVisible}
          onClose={closePopover}
          intl={intl}
        />
      )}
    </div>
  )
}
