import type { GridRow } from '@/features/grid/types'

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
