import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import type { GridColumn, GridRow, CalendarDay } from '@/features/grid/types'
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
}

function toFullDatetime(date: string, time: string): string {
  return `${date}T${time}`
}

function heatColor(availableRatio: number, ifNeededRatio: number): string {
  const total = availableRatio + ifNeededRatio
  if (total === 0) return 'bg-gray-50'
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
}: {
  state: NonNullable<PopoverState>
  detail: SlotDetail
  total: number
  namesVisible: boolean
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

  const dateStr = new Date(state.slot.split('T')[0] + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })

  return (
    <div
      ref={ref}
      role="tooltip"
      className="fixed z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-sm max-w-56"
    >
      <div className="font-medium mb-1 text-xs text-gray-500">
        {state.slot.split('T')[1]} · {dateStr}
      </div>
      {namesVisible ? (
        <>
          {detail.available.length > 0 && (
            <div className="mb-0.5">
              <span className="text-green-600 font-medium">Available:</span>{' '}
              {detail.available.join(', ')}
            </div>
          )}
          {detail.ifNeeded.length > 0 && (
            <div className="mb-0.5">
              <span className="text-yellow-600 font-medium">If needed:</span>{' '}
              {detail.ifNeeded.join(', ')}
            </div>
          )}
          {detail.available.length === 0 && detail.ifNeeded.length === 0 && (
            <div className="text-gray-400">No one available</div>
          )}
        </>
      ) : (
        <div>
          {detail.available.length + detail.ifNeeded.length} / {total} responded
        </div>
      )}
    </div>
  )
}

export function HeatmapView({ columns, rows, participants, namesVisible }: Props) {
  const [popover, setPopover] = useState<PopoverState>(null)
  const weeks = useMemo(() => buildCalendarWeeks(columns), [columns])
  const total = participants.length

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
    return <p className="text-gray-500 text-sm">No responses yet.</p>
  }

  let prevDay: CalendarDay | undefined

  return (
    <div>
      <div className="overflow-auto max-h-[70vh] border border-gray-300 rounded">
        <div className="flex">
          {/* Time labels */}
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
                        <div key={row.slot} className="h-6 border-b border-r border-gray-100 bg-gray-50" />
                      ))}
                    </div>
                  )
                }

                return (
                  <div key={day.eventDateId} className="min-w-10 flex-1">
                    <div className="h-12 border-b border-gray-300 text-center sticky top-0 bg-white z-10 flex flex-col justify-end pb-0.5">
                      {ml && (
                        <span className="text-[9px] text-gray-400 font-medium leading-none">{ml}</span>
                      )}
                      <span className="text-[10px] text-gray-400 leading-none">{day.weekday}</span>
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
                          className={`h-6 border-b border-r border-gray-200 cursor-pointer flex items-center justify-center text-[9px] font-medium ${heatColor(availRatio, ifNeededRatio)} ${isSelected ? 'ring-2 ring-inset ring-blue-500' : ''}`}
                          onClick={(e) => handleCellClick(e, day.eventDateId!, fullSlot)}
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
          ))}
        </div>
      </div>

      {popover && popoverDetail && (
        <SlotPopover
          state={popover}
          detail={popoverDetail}
          total={total}
          namesVisible={namesVisible}
          onClose={closePopover}
        />
      )}
    </div>
  )
}
