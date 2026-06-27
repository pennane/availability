import { useRef, useCallback } from 'react'
import type { CellState, SlotEntry } from './types'

const NEXT_STATE: Record<CellState, CellState> = {
  empty: 'available',
  available: 'if-needed',
  'if-needed': 'empty',
}

type Params = {
  entries: SlotEntry[]
  onChange: (entries: SlotEntry[]) => void
}

export function useGridInteraction({ entries, onChange }: Params) {
  const paintState = useRef<CellState | null>(null)
  const paintedCells = useRef<Set<string>>(new Set())

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

  const updateCell = useCallback(
    (eventDateId: string, slot: string, newState: CellState) => {
      const key = getKey(eventDateId, slot)
      if (paintedCells.current.has(key)) return

      paintedCells.current.add(key)
      const filtered = entries.filter(
        (e) => !(e.eventDateId === eventDateId && e.slot === slot),
      )
      if (newState !== 'empty') {
        filtered.push({ eventDateId, slot, state: newState })
      }
      onChange(filtered)
    },
    [entries, onChange],
  )

  const onPointerDown = useCallback(
    (eventDateId: string, slot: string) => {
      const current = getState(eventDateId, slot)
      const next = NEXT_STATE[current]
      paintState.current = next
      paintedCells.current = new Set()
      updateCell(eventDateId, slot, next)
    },
    [getState, updateCell],
  )

  const onPointerEnter = useCallback(
    (eventDateId: string, slot: string) => {
      if (paintState.current === null) return
      updateCell(eventDateId, slot, paintState.current)
    },
    [updateCell],
  )

  const onPointerUp = useCallback(() => {
    paintState.current = null
    paintedCells.current = new Set()
  }, [])

  return { getState, onPointerDown, onPointerEnter, onPointerUp }
}
