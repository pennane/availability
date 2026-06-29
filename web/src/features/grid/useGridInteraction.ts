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

  const startCoords = useRef({ x: 0, y: 0 })
  const startPointerType = useRef<string | null>(null)
  const isDragging = useRef(false)

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
    (eventDateId: string, slot: string, rowIndex: number, pointerType: string, clientX: number, clientY: number) => {
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
      startCoords.current = { x: clientX, y: clientY }
      startPointerType.current = pointerType
      isDragging.current = false

      const updated = applyToCell(entriesRef.current, eventDateId, slot, next)
      entriesRef.current = updated
      onChange(updated)
    },
    [getState, onChange],
  )

  const onPointerMove = useCallback(
    (e: { clientX: number; clientY: number }) => {
      if (paintState.current === null) return

      if (!isDragging.current) {
        if (startPointerType.current === 'touch') {
          const dx = e.clientX - startCoords.current.x
          const dy = e.clientY - startCoords.current.y
          if (dx * dx + dy * dy < 25) return
        }
        isDragging.current = true
      }

      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!(el instanceof HTMLElement)) return

      const eventDateId = el.dataset.eventDateId
      const slot = el.dataset.slot
      const rowIndexStr = el.dataset.rowIndex
      if (!eventDateId || !slot || rowIndexStr == null) return

      if (dragColumn.current !== null && eventDateId !== dragColumn.current) return

      const rowIndex = parseInt(rowIndexStr, 10)
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

  const onPointerUp = useCallback((): boolean => {
    const wasDragging = isDragging.current
    paintState.current = null
    paintedCells.current = new Set()
    dragColumn.current = null
    dragDate.current = null
    lastRow.current = null
    isDragging.current = false
    startCoords.current = { x: 0, y: 0 }
    startPointerType.current = null
    return wasDragging
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

  return { getState, onPointerDown, onPointerMove, onPointerUp, setSlotList, toggleDay }
}
