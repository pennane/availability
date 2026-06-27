export type CellState = 'empty' | 'available' | 'if-needed'

export type SlotEntry = {
  eventDateId: string
  slot: string // full ISO datetime
  state: CellState
  reason?: string
}

export type GridColumn = {
  eventDateId: string
  date: string
}

export type GridRow = {
  slot: string // display label, e.g. "09:00"
  datetime: string // full ISO datetime template
}
