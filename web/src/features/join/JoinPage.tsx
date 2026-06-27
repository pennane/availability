import { useState } from 'react'
import { TextField, Input, Label } from 'react-aria-components'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { setToken } from '@/shared/api/token'

type Props = {
  eventId: string
  event: { title: string; description?: string }
}

export function JoinPage({ eventId, event }: Props) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const join = async () => {
    if (!name.trim()) return
    setSubmitting(true)

    const { data, error } = await api.POST('/events/{eventId}/me', {
      params: { path: { eventId } },
      body: { name: name.trim() },
    })

    if (error || !data) {
      setSubmitting(false)
      return
    }

    setToken(eventId, data.token)
    queryClient.invalidateQueries({ queryKey: ['event', eventId] })
  }

  return (
    <div className="max-w-md mx-auto p-4 text-center">
      <h1 className="text-2xl font-bold mb-2">{event.title}</h1>
      {event.description && <p className="text-gray-600 mb-6">{event.description}</p>}

      <TextField className="mb-4 text-left" value={name} onChange={setName}>
        <Label className="block text-sm font-medium mb-1">Your name</Label>
        <Input className="w-full border rounded px-3 py-2" placeholder="Enter your name" />
      </TextField>

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
