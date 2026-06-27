import { FormattedMessage } from 'react-intl'
import type { GridColumn, GridRow } from '@/features/grid/types'

type ParticipantAvailability = {
  id: string
  name: string
  availability: Array<{ kind: string; eventDateId: string; slot: string }>
}

type Props = {
  columns: GridColumn[]
  rows: GridRow[]
  participants: ParticipantAvailability[]
}

const KIND_CLASSES: Record<string, string> = {
  available: 'bg-green-400',
  'if-needed': 'bg-yellow-300',
}

function toFullDatetime(date: string, time: string): string {
  return `${date}T${time}`
}

export function ResultsView({ columns, rows, participants }: Props) {
  if (participants.length === 0) {
    return <p className="text-gray-500 text-sm"><FormattedMessage id="event.noResponses" defaultMessage="No responses yet." /></p>
  }

  return (
    <div className="overflow-x-auto">
      {participants.map((p) => (
        <div key={p.id} className="mb-4">
          <h3 className="text-sm font-medium mb-1">{p.name}</h3>
          <div
            className="inline-grid"
            style={{
              gridTemplateColumns: `4rem repeat(${columns.length}, minmax(3rem, 1fr))`,
            }}
          >
            <div />
            {columns.map((col) => (
              <div
                key={col.eventDateId}
                className="text-center text-xs text-gray-400 p-1 truncate"
              >
                {col.date}
              </div>
            ))}
            {rows.map((row) => (
              <>
                <div
                  key={`label-${row.slot}`}
                  className="text-xs text-gray-500 text-right pr-2 flex items-center justify-end"
                >
                  {row.slot}
                </div>
                {columns.map((col) => {
                  const fullSlot = toFullDatetime(col.date, row.datetime)
                  const entry = p.availability.find(
                    (a) => a.eventDateId === col.eventDateId && a.slot === fullSlot,
                  )
                  const cls = entry
                    ? (KIND_CLASSES[entry.kind] ?? 'bg-gray-50')
                    : 'bg-gray-50'
                  return (
                    <div
                      key={`${col.eventDateId}-${row.slot}`}
                      className={`h-6 border border-gray-200 ${cls}`}
                    />
                  )
                })}
              </>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
