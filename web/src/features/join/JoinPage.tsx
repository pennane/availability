import { useState } from 'react'
import { TextField, Input, Label } from 'react-aria-components'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { api } from '@/shared/api/client'
import { setToken } from '@/shared/api/token'

type Props = {
  eventId: string
  event: { title: string; description?: string }
  shareToken: string
}

export function JoinPage({ eventId, event, shareToken }: Props) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const join = async () => {
    if (!name.trim()) return
    setSubmitting(true)
    setError(null)

    const { data, error: apiError } = await api.POST('/events/{eventId}/me', {
      params: { path: { eventId } },
      body: { name: name.trim(), shareToken },
    })

    if (apiError || !data) {
      setSubmitting(false)
      setError('Failed to join. The invite link may have been revoked.')
      return
    }

    setToken(eventId, data.token)
    await queryClient.invalidateQueries({ queryKey: ['event', eventId] })
    navigate({ to: '/events/$eventId', params: { eventId } })
  }

  return (
    <div className="max-w-md mx-auto p-4 text-center">
      <h1 className="text-2xl font-bold mb-2">{event.title}</h1>
      {event.description && <p className="text-gray-600 mb-6">{event.description}</p>}

      <TextField className="mb-4 text-left" value={name} onChange={setName}>
        <Label className="block text-sm font-medium mb-1">Your name</Label>
        <Input className="w-full border rounded px-3 py-2" placeholder="Enter your name" />
      </TextField>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <button
        className="w-full py-3 bg-blue-600 text-white rounded font-medium disabled:opacity-50"
        disabled={!name.trim() || submitting}
        onClick={join}
      >
        {submitting ? 'Joining...' : 'Join'}
      </button>
    </div>
  )
}
