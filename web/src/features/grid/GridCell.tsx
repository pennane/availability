import type { CellState } from './types'

const STATE_CLASSES: Record<CellState, string> = {
  empty: 'bg-gray-50 hover:bg-gray-100',
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
  onPointerDown: () => void
  onPointerEnter: () => void
}

export function GridCell({ state, onPointerDown, onPointerEnter }: Props) {
  return (
    <div
      role="gridcell"
      aria-label={STATE_LABELS[state]}
      className={`h-8 border border-gray-200 cursor-pointer select-none touch-none ${STATE_CLASSES[state]}`}
      onPointerDown={(e) => {
        e.preventDefault()
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
        onPointerDown()
      }}
      onPointerEnter={onPointerEnter}
    />
  )
}
