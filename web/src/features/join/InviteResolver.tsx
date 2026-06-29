import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { FormattedMessage } from 'react-intl'
import { api } from '@/shared/api/client'
import { setToken, setIndividualLink } from '@/shared/api/token'
import { JoinPage } from './JoinPage'

export function InviteResolver({ eventId, token }: { eventId: string; token: string }) {
  const navigate = useNavigate()
  const goToEvent = () => navigate({ to: '/events/$eventId', params: { eventId } })

  const { data, isLoading } = useQuery({
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
      goToEvent()
    } else if (data.kind === 'individual' && data.participantToken) {
      setToken(eventId, data.participantToken)
      setIndividualLink(eventId)
      goToEvent()
    }
  }, [data, isLoading, eventId, token, navigate])

  if (isLoading) return <div className="p-4 text-center"><FormattedMessage id="common.loading" defaultMessage="Loading..." /></div>

  if (data?.kind === 'global') {
    return <JoinPage eventId={eventId} event={{ title: data.title, description: data.description }} shareToken={token} />
  }

  return <div className="p-4 text-center"><FormattedMessage id="common.redirecting" defaultMessage="Redirecting..." /></div>
}
