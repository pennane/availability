import { createRouter, createRoute, createRootRoute, redirect } from '@tanstack/react-router'
import { CreateEventPage } from '@/features/event-config/CreateEventPage'
import { EventView } from '@/features/join/EventView'
import { InviteResolver } from '@/features/join/InviteResolver'
import { getToken } from '@/shared/api/token'

const rootRoute = createRootRoute()

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: CreateEventPage,
})

const eventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId',
  component: () => {
    const { eventId } = eventRoute.useParams()
    return <EventView eventId={eventId} />
  },
})

const eventWithTokenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId/$token',
  beforeLoad: ({ params }) => {
    if (getToken(params.eventId)) {
      throw redirect({ to: '/events/$eventId', params: { eventId: params.eventId } })
    }
  },
  component: () => {
    const { eventId, token } = eventWithTokenRoute.useParams()
    return <InviteResolver eventId={eventId} token={token} />
  },
})

const routeTree = rootRoute.addChildren([indexRoute, eventRoute, eventWithTokenRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
