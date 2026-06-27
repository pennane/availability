import { useState } from 'react'
import { TextField, Input, Label } from 'react-aria-components'
import { FormattedMessage, useIntl } from 'react-intl'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { api } from '@/shared/api/client'
import { Button } from '@/shared/ui/Button'
import { setToken } from '@/shared/api/token'

type Props = {
  eventId: string
  event: { title: string; description?: string }
  shareToken: string
}

export function JoinPage({ eventId, event, shareToken }: Props) {
  const intl = useIntl()
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
      setError(intl.formatMessage({ id: 'join.error', defaultMessage: 'Failed to join. The invite link may have been revoked.' }))
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
        <Label className="block text-sm font-medium mb-1"><FormattedMessage id="join.yourName" defaultMessage="Your name" /></Label>
        <Input className="w-full border rounded px-3 py-2" placeholder={intl.formatMessage({ id: 'join.namePlaceholder', defaultMessage: 'Enter your name' })} />
      </TextField>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <Button
        size="lg"
        disabled={!name.trim() || submitting}
        onClick={join}
      >
        {submitting ? <FormattedMessage id="join.submitting" defaultMessage="Joining..." /> : <FormattedMessage id="join.submit" defaultMessage="Join" />}
      </Button>
    </div>
  )
}
