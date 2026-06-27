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
  rowIndex: number
  onPointerDown: (rowIndex: number, pointerType: string) => void
  onPointerEnter: (rowIndex: number) => void
}

export function GridCell({ state, rowIndex, onPointerDown, onPointerEnter }: Props) {
  return (
    <div
      role="checkbox"
      aria-checked={state === 'if-needed' ? 'mixed' : state !== 'empty'}
      aria-label={STATE_LABELS[state]}
      className={`h-6 min-h-6 border-b border-r border-gray-200 cursor-pointer select-none touch-none ${STATE_CLASSES[state]}`}
      onPointerDown={(e) => {
        e.preventDefault()
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
        onPointerDown(rowIndex, e.pointerType)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onPointerDown(rowIndex, 'context')
      }}
      onPointerEnter={() => onPointerEnter(rowIndex)}
    />
  )
}
