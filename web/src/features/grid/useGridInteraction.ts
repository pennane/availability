import { useRef, useCallback } from 'react'
import type { CellState, SlotEntry } from './types'

const CYCLE_ORDER: CellState[] = ['empty', 'available', 'if-needed']

function nextInCycle(current: CellState): CellState {
  const i = CYCLE_ORDER.indexOf(current)
  return CYCLE_ORDER[(i + 1) % CYCLE_ORDER.length]
}

function datePrefix(fullSlot: string): string {
  return fullSlot.split('T')[0]
}

type Params = {
  entries: SlotEntry[]
  onChange: (entries: SlotEntry[]) => void
}

export function useGridInteraction({ entries, onChange }: Params) {
  const paintState = useRef<CellState | null>(null)
  const paintedCells = useRef<Set<string>>(new Set())
  const dragColumn = useRef<string | null>(null)
  const dragDate = useRef<string | null>(null)
  const lastRow = useRef<number | null>(null)
  const rowsRef = useRef<string[]>([])
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  const getKey = (eventDateId: string, slot: string) => `${eventDateId}:${slot}`

  const getState = useCallback(
    (eventDateId: string, slot: string): CellState => {
      const entry = entries.find(
        (e) => e.eventDateId === eventDateId && e.slot === slot,
      )
      return entry?.state ?? 'empty'
    },
    [entries],
  )

  const applyToCell = (
    currentEntries: SlotEntry[],
    eventDateId: string,
    slot: string,
    newState: CellState,
  ): SlotEntry[] => {
    const key = getKey(eventDateId, slot)
    if (paintedCells.current.has(key)) return currentEntries
    paintedCells.current.add(key)
    const filtered = currentEntries.filter(
      (e) => !(e.eventDateId === eventDateId && e.slot === slot),
    )
    if (newState !== 'empty') {
      filtered.push({ eventDateId, slot, state: newState })
    }
    return filtered
  }

  const fillRange = (eventDateId: string, date: string, fromRow: number, toRow: number, state: CellState) => {
    const lo = Math.min(fromRow, toRow)
    const hi = Math.max(fromRow, toRow)
    let current = entriesRef.current
    for (let i = lo; i <= hi; i++) {
      const time = rowsRef.current[i]
      if (time) {
        current = applyToCell(current, eventDateId, `${date}T${time}`, state)
      }
    }
    entriesRef.current = current
    onChange(current)
  }

  const onPointerDown = useCallback(
    (eventDateId: string, slot: string, rowIndex: number, pointerType: string) => {
      const current = getState(eventDateId, slot)
      let next: CellState

      if (pointerType === 'context') {
        next = current === 'if-needed' ? 'empty' : 'if-needed'
      } else if (pointerType === 'touch') {
        next = nextInCycle(current)
      } else {
        next = current === 'available' ? 'empty' : 'available'
      }

      paintState.current = next
      dragColumn.current = eventDateId
      dragDate.current = datePrefix(slot)
      lastRow.current = rowIndex
      paintedCells.current = new Set()
      const updated = applyToCell(entriesRef.current, eventDateId, slot, next)
      entriesRef.current = updated
      onChange(updated)
    },
    [getState, onChange],
  )

  const onPointerEnter = useCallback(
    (eventDateId: string, slot: string, rowIndex: number) => {
      if (paintState.current === null) return
      if (dragColumn.current !== null && eventDateId !== dragColumn.current) return
      const date = datePrefix(slot)
      if (lastRow.current !== null && Math.abs(rowIndex - lastRow.current) > 1) {
        fillRange(eventDateId, date, lastRow.current, rowIndex, paintState.current)
      } else {
        const updated = applyToCell(entriesRef.current, eventDateId, slot, paintState.current)
        entriesRef.current = updated
        onChange(updated)
      }
      lastRow.current = rowIndex
    },
    [onChange],
  )

  const onPointerUp = useCallback(() => {
    paintState.current = null
    paintedCells.current = new Set()
    dragColumn.current = null
    dragDate.current = null
    lastRow.current = null
  }, [])

  const setSlotList = useCallback((slots: string[]) => {
    rowsRef.current = slots
  }, [])

  const toggleDay = useCallback(
    (eventDateId: string, date: string, targetState: 'available' | 'if-needed') => {
      const slots = rowsRef.current
      const dayEntries = entriesRef.current.filter((e) => e.eventDateId === eventDateId)
      const allMatch = slots.length > 0 && dayEntries.length === slots.length
        && dayEntries.every((e) => e.state === targetState)

      const newState: CellState = allMatch ? 'empty' : targetState
      let updated = entriesRef.current.filter((e) => e.eventDateId !== eventDateId)
      if (newState !== 'empty') {
        for (const slot of slots) {
          updated.push({ eventDateId, slot: `${date}T${slot}`, state: newState })
        }
      }
      entriesRef.current = updated
      onChange(updated)
    },
    [onChange],
  )

  return { getState, onPointerDown, onPointerEnter, onPointerUp, setSlotList, toggleDay }
}
