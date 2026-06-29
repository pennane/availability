import type { CellState } from './types'

const STATE_CLASSES: Record<CellState, string> = {
  empty: 'bg-grid-empty hover:bg-grid-empty-hover',
  available: 'bg-green-400',
  'if-needed': 'bg-yellow-300',
}

const STATE_LABELS: Record<CellState, string> = {
  empty: 'Unavailable',
  available: 'Available',
  'if-needed': 'If needed',
}

type Props = {
  state: CellState
  eventDateId: string
  slot: string
  rowIndex: number
  onPointerDown: (rowIndex: number, pointerType: string, clientX: number, clientY: number) => void
}

export function GridCell({ state, eventDateId, slot, rowIndex, onPointerDown }: Props) {
  return (
    <div
      role="checkbox"
      aria-checked={state === 'if-needed' ? 'mixed' : state !== 'empty'}
      aria-label={STATE_LABELS[state]}
      data-event-date-id={eventDateId}
      data-slot={slot}
      data-row-index={rowIndex}
      className={`h-6 min-h-6 border-b border-r border-grid-border cursor-pointer select-none touch-none ${STATE_CLASSES[state]}`}
      onPointerDown={(e) => {
        e.preventDefault()
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
        onPointerDown(rowIndex, e.pointerType, e.clientX, e.clientY)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onPointerDown(rowIndex, 'context', e.clientX, e.clientY)
      }}
    />
  )
}
