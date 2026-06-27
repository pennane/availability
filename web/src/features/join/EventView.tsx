import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { useEventWebSocket } from '@/shared/api/ws'
import { generateSlotRows } from '@/shared/grid/slots'
import { JoinPage } from './JoinPage'
import { AvailabilityGrid } from '@/features/grid/AvailabilityGrid'
import { ResultsView } from '@/features/results/ResultsView'
import type { SlotEntry, GridColumn } from '@/features/grid/types'

export function EventView({ eventId }: { eventId: string }) {
  useEventWebSocket(eventId)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['event', eventId],
    queryFn: async () => {
      const { data, error } = await api.GET('/events/{eventId}', {
        params: { path: { eventId } },
      })
      if (error) throw error
      return data
    },
  })

  const myData = useQuery({
    queryKey: ['event', eventId, 'me'],
    queryFn: async () => {
      const { data, error } = await api.GET('/events/{eventId}/me', {
        params: { path: { eventId } },
      })
      if (error) throw error
      return data
    },
    enabled: data?.role === 'participant' || data?.role === 'host',
  })

  const [localEntries, setLocalEntries] = useState<SlotEntry[] | null>(null)

  const entries: SlotEntry[] = useMemo(() => {
    if (localEntries !== null) return localEntries
    if (!myData.data?.availability) return []
    return myData.data.availability.map((a) => ({
      eventDateId: a.eventDateId,
      slot: a.slot,
      state: a.kind === 'available' ? ('available' as const) : ('if-needed' as const),
      reason: 'reason' in a ? a.reason : undefined,
    }))
  }, [localEntries, myData.data])

  const saveMutation = useMutation({
    mutationFn: async (newEntries: SlotEntry[]) => {
      await api.PUT('/events/{eventId}/me/availability', {
        params: { path: { eventId } },
        body: {
          entries: newEntries.map((e) => ({
            kind: e.state === 'available' ? ('available' as const) : ('if-needed' as const),
            eventDateId: e.eventDateId,
            slot: e.slot,
          })),
        },
      })
    },
    onSuccess: () => {
      setLocalEntries(null)
      queryClient.invalidateQueries({ queryKey: ['event', eventId] })
    },
  })

  const handleChange = useCallback((newEntries: SlotEntry[]) => {
    setLocalEntries(newEntries)
  }, [])

  if (isLoading) return <div className="p-4">Loading...</div>
  if (!data) return <div className="p-4">Event not found</div>
  if (data.role === 'public') return <JoinPage eventId={eventId} event={data} />

  const columns: GridColumn[] = data.dates.map((d) => ({
    eventDateId: d.id,
    date: d.date,
  }))

  const rows = generateSlotRows(data.timeSlotConfig)

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">{data.title}</h1>
      {data.description && <p className="text-gray-600 mb-4">{data.description}</p>}
      <p className="text-sm text-gray-500 mb-6">
        {data.timezone} · {data.role === 'host' ? 'Host' : 'Participant'}
      </p>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Your Availability</h2>
        <AvailabilityGrid
          columns={columns}
          timeSlotConfig={data.timeSlotConfig}
          entries={entries}
          onChange={handleChange}
        />
        {localEntries !== null && (
          <button
            className="mt-3 px-6 py-2 bg-blue-600 text-white rounded font-medium disabled:opacity-50"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate(entries)}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        )}
      </section>

      {'participants' in data && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Responses</h2>
          <ResultsView
            columns={columns}
            rows={rows}
            participants={data.participants}
          />
        </section>
      )}
    </div>
  )
}
