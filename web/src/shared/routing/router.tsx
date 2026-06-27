import { createRouter, createRoute, createRootRoute, redirect } from '@tanstack/react-router'
import { CreateEventPage } from '@/features/event-config/CreateEventPage'
import { EventView } from '@/features/join/EventView'
import { setToken } from '@/shared/api/token'

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
    setToken(params.eventId, params.token)
    throw redirect({ to: '/events/$eventId', params: { eventId: params.eventId } })
  },
})

const routeTree = rootRoute.addChildren([indexRoute, eventRoute, eventWithTokenRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
