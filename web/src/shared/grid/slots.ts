import type { GridRow, GridColumn, CalendarDay, CalendarWeek } from '@/features/grid/types'

type TimeSlotConfig = {
  durationMinutes: number
  rangeStart: string
  rangeEnd: string
}

export function generateSlotRows(config: TimeSlotConfig): GridRow[] {
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

const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

function toDate(iso: string): Date {
  return new Date(iso + 'T12:00:00')
}

function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getMonday(d: Date): Date {
  const result = new Date(d)
  const day = d.getDay()
  const diff = (day + 6) % 7
  result.setDate(d.getDate() - diff)
  return result
}

export function buildCalendarWeeks(columns: GridColumn[]): CalendarWeek[] {
  if (columns.length === 0) return []

  const activeMap = new Map<string, string>()
  for (const col of columns) {
    activeMap.set(col.date, col.eventDateId)
  }

  const firstDate = toDate(columns[0].date)
  const lastDate = toDate(columns[columns.length - 1].date)
  const firstMonday = getMonday(firstDate)
  const lastMonday = getMonday(lastDate)

  const weeks: CalendarWeek[] = []
  const current = new Date(firstMonday)

  while (current <= lastMonday) {
    const days: CalendarDay[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(current)
      d.setDate(current.getDate() + i)
      const iso = toISO(d)
      const eventDateId = activeMap.get(iso)
      days.push({
        date: iso,
        dayNum: d.getDate(),
        weekday: weekdayFormatter.format(d),
        active: eventDateId !== undefined,
        eventDateId,
      })
    }
    weeks.push({ key: toISO(current), days })
    current.setDate(current.getDate() + 7)
  }

  return weeks
}

const shortDateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

export function weekRangeLabel(week: CalendarWeek): string {
  const first = week.days[0]
  const last = week.days[week.days.length - 1]
  return shortDateFormatter.formatRange(toDate(first.date), toDate(last.date))
}

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'short' })

export function monthLabel(day: CalendarDay, prevDay: CalendarDay | undefined): string | null {
  const d = toDate(day.date)
  if (!prevDay) return monthFormatter.format(d)
  const prevMonth = toDate(prevDay.date).getMonth()
  if (d.getMonth() !== prevMonth) return monthFormatter.format(d)
  return null
}
