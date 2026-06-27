import type { GridRow, GridColumn, CalendarDay, CalendarWeek } from '@/features/grid/types'

type TimeSlotConfig = {
  durationMinutes: number
  rangeStart: string
  rangeEnd: string
}

export function toFullDatetime(date: string, time: string): string {
  return `${date}T${time}`
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

let cachedLocale: string | undefined
let weekdayFmt: Intl.DateTimeFormat
let shortDateFmt: Intl.DateTimeFormat
let monthFmt: Intl.DateTimeFormat

function ensureFormatters(locale: string) {
  if (locale === cachedLocale) return
  cachedLocale = locale
  weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  shortDateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
  monthFmt = new Intl.DateTimeFormat(locale, { month: 'short' })
}

export function buildCalendarWeeks(columns: GridColumn[], locale: string): CalendarWeek[] {
  if (columns.length === 0) return []
  ensureFormatters(locale)

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
        weekday: weekdayFmt.format(d),
        active: eventDateId !== undefined,
        eventDateId,
      })
    }
    weeks.push({ key: toISO(current), days })
    current.setDate(current.getDate() + 7)
  }

  return weeks
}

export function weekRangeLabel(week: CalendarWeek, locale: string): string {
  ensureFormatters(locale)
  const first = week.days[0]
  const last = week.days[week.days.length - 1]
  return shortDateFmt.formatRange(toDate(first.date), toDate(last.date))
}

export function monthLabel(day: CalendarDay, prevDay: CalendarDay | undefined, locale: string): string | null {
  ensureFormatters(locale)
  const d = toDate(day.date)
  if (!prevDay) return monthFmt.format(d)
  const prevMonth = toDate(prevDay.date).getMonth()
  if (d.getMonth() !== prevMonth) return monthFmt.format(d)
  return null
}
