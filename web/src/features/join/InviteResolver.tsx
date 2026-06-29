import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { FormattedMessage } from 'react-intl'
import { api } from '@/shared/api/client'
import { setToken, setIndividualLink } from '@/shared/api/token'
import { JoinPage } from './JoinPage'

type Props = {
  eventId: string
  token: string
}

export function InviteResolver({ eventId, token }: Props) {
  const navigate = useNavigate()

  const { data, isLoading, error } = useQuery({
    queryKey: ['invite', eventId, token],
    queryFn: async () => {
      const { data, error } = await api.GET('/events/{eventId}/invite/{token}', {
        params: { path: { eventId, token } },
      })
      if (error) return null
      return data
    },
    retry: false,
  })

  useEffect(() => {
    if (isLoading) return
    if (!data) {
      setToken(eventId, token)
      navigate({ to: '/events/$eventId', params: { eventId } })
      return
    }
    if (data.kind === 'individual' && data.participantToken) {
      setToken(eventId, data.participantToken)
      setIndividualLink(eventId)
      navigate({ to: '/events/$eventId', params: { eventId } })
    }
  }, [data, isLoading, eventId, token, navigate])

  if (isLoading) return <div className="p-4 text-center"><FormattedMessage id="common.loading" defaultMessage="Loading..." /></div>

  if (data) {
    if (data.kind === 'individual') {
      return <div className="p-4 text-center"><FormattedMessage id="common.redirecting" defaultMessage="Redirecting..." /></div>
    }
    return (
      <JoinPage
        eventId={eventId}
        event={{ title: data.title, description: data.description }}
        shareToken={token}
      />
    )
  }

  return <div className="p-4 text-center"><FormattedMessage id="common.redirecting" defaultMessage="Redirecting..." /></div>
}
