import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { useEventWebSocket } from '@/shared/api/ws'
import { JoinPage } from './JoinPage'

export function EventView({ eventId }: { eventId: string }) {
  useEventWebSocket(eventId)

  const { data, isLoading, error } = useQuery({
    queryKey: ['event', eventId],
    queryFn: async () => {
      const { data, error } = await api.GET('/events/{eventId}', {
        params: { path: { eventId } },
      })
      if (error) throw error
      return data
    },
  })

  if (isLoading) return <div className="p-4">Loading...</div>
  if (error || !data) return <div className="p-4">Event not found</div>

  if (data.role === 'public') {
    return <JoinPage eventId={eventId} event={data} />
  }

  // Participant or host view — grid and results will be added in later tasks
  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">{data.title}</h1>
      {data.description && <p className="text-gray-600 mb-4">{data.description}</p>}
      <p className="text-sm text-gray-500 mb-4">
        {data.timezone} · {data.role === 'host' ? 'You are the host' : 'Participant view'}
      </p>
      <p className="text-sm text-gray-400">Grid and results view coming next...</p>
    </div>
  )
}
