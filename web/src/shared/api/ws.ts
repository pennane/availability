import { useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getToken } from './token'

type EventMessage = {
  kind:
    | 'availability-updated'
    | 'participant-joined'
    | 'date-suggested'
    | 'settings-changed'
  participantId?: string
  name?: string
  eventDateId?: string
  date?: string
  nonce?: string
}

const WS_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8080').replace(
  /^http/,
  'ws',
)

export function useEventWebSocket(
  eventId: string | undefined,
  nonceRef?: { current: string | null }
) {
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)
  const retryCount = useRef(0)

  const connect = useCallback(() => {
    if (!eventId) return

    const token = getToken(eventId)
    const url = `${WS_BASE}/events/${eventId}/live${token ? `?token=${token}` : ''}`
    const ws = new WebSocket(url)

    ws.onopen = () => {
      retryCount.current = 0
    }

    ws.onmessage = (event) => {
      const msg: EventMessage = JSON.parse(event.data as string)
      switch (msg.kind) {
        case 'availability-updated':
          if (nonceRef?.current && msg.nonce === nonceRef.current) break
          queryClient.invalidateQueries({ queryKey: ['event', eventId] })
          break
        case 'participant-joined':
        case 'settings-changed':
        case 'date-suggested':
          queryClient.invalidateQueries({ queryKey: ['event', eventId] })
          break
      }
    }

    ws.onclose = () => {
      const delay = Math.min(1000 * 2 ** retryCount.current, 30000)
      retryCount.current++
      reconnectTimeout.current = setTimeout(connect, delay)
    }

    wsRef.current = ws
  }, [eventId, queryClient, nonceRef])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimeout.current)
      wsRef.current?.close()
    }
  }, [connect])
}
