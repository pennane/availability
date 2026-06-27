import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  type RefObject
} from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { useEventWebSocket } from '@/shared/api/ws'
import { getToken, trackEvent } from '@/shared/api/token'
import { generateSlotRows } from '@/shared/grid/slots'
import {
  AvailabilityGrid,
  WeekMinimap,
  buildCalendarWeeks
} from '@/features/grid/AvailabilityGrid'
import { HeatmapView } from '@/features/results/HeatmapView'
import type { SlotEntry, GridColumn } from '@/features/grid/types'
import type { components } from '@/shared/api/generated/schema'
import { FormattedMessage, useIntl } from 'react-intl'
import { LocaleSwitcher } from '@/shared/i18n/LocaleSwitcher'
import { ThemeSwitcher } from '@/shared/theme/ThemeSwitcher'

type AuthenticatedView =
  | components['schemas']['ParticipantEventView']
  | components['schemas']['HostEventView']
type Participant = components['schemas']['ParticipantWithAvailability']

type DateScore = {
  date: string
  eventDateId: string
  available: string[]
  ifNeeded: string[]
}

function bestDates(
  columns: GridColumn[],
  participants: Participant[]
): DateScore[] {
  const scores = new Map<string, DateScore>()
  for (const col of columns) {
    scores.set(col.eventDateId, {
      date: col.date,
      eventDateId: col.eventDateId,
      available: [],
      ifNeeded: []
    })
  }
  for (const p of participants) {
    const seenDates = new Set<string>()
    for (const a of p.availability) {
      if (seenDates.has(a.eventDateId)) continue
      seenDates.add(a.eventDateId)
      const score = scores.get(a.eventDateId)
      if (!score) continue
      if (a.kind === 'available') score.available.push(p.name)
      else if (a.kind === 'if-needed') score.ifNeeded.push(p.name)
    }
  }
  return [...scores.values()]
    .filter((s) => s.available.length + s.ifNeeded.length > 0)
    .sort((a, b) => {
      const aTotal = a.available.length * 2 + a.ifNeeded.length
      const bTotal = b.available.length * 2 + b.ifNeeded.length
      return bTotal - aTotal
    })
}

function GroupSummary({
  columns,
  participants,
  namesVisible,
  isHost,
  eventId,
  suggestionsOpen
}: {
  columns: GridColumn[]
  participants: Participant[]
  namesVisible: boolean
  suggestionsOpen: boolean
  isHost: boolean
  eventId: string
}) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const ranked = useMemo(
    () => bestDates(columns, participants),
    [columns, participants]
  )
  const total = participants.length

  const removeMutation = useMutation({
    mutationFn: async (participantId: string) => {
      await api.DELETE('/events/{eventId}/participants/{participantId}', {
        params: { path: { eventId, participantId } }
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', eventId] })
    }
  })

  const [confirmId, setConfirmId] = useState<string | null>(null)

  if (total === 0) return null

  const topDates = ranked.slice(0, 5)

  return (
    <div className="mb-4 border border-gray-200 rounded p-3 space-y-3 max-w-md">
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          <FormattedMessage
            id="event.respondents"
            defaultMessage="Respondents ({count})"
            values={{ count: total }}
          />
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {participants.map((p) => (
            <span
              key={p.id}
              className="text-xs px-2 py-0.5 bg-gray-100 rounded-full text-gray-700 inline-flex items-center gap-1"
            >
              {namesVisible
                ? p.name
                : intl.formatMessage({
                    id: 'event.anonymous',
                    defaultMessage: 'Anonymous'
                  })}
              {isHost && confirmId !== p.id && (
                <button
                  onClick={() => setConfirmId(p.id)}
                  className="text-gray-400 hover:text-red-500 leading-none cursor-pointer"
                  aria-label={intl.formatMessage(
                    {
                      id: 'event.removeParticipant',
                      defaultMessage: 'Remove {name}'
                    },
                    { name: p.name }
                  )}
                >
                  &times;
                </button>
              )}
              {isHost && confirmId === p.id && (
                <>
                  <button
                    onClick={() => {
                      removeMutation.mutate(p.id)
                      setConfirmId(null)
                    }}
                    disabled={removeMutation.isPending}
                    className="text-red-600 hover:text-red-800 text-[10px] font-medium leading-none cursor-pointer"
                  >
                    <FormattedMessage
                      id="event.removeConfirm"
                      defaultMessage="Remove"
                    />
                  </button>
                  <button
                    onClick={() => setConfirmId(null)}
                    className="text-gray-400 hover:text-gray-600 leading-none cursor-pointer"
                  >
                    &times;
                  </button>
                </>
              )}
            </span>
          ))}
        </div>
      </div>

      {topDates.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            <FormattedMessage
              id="event.bestDates"
              defaultMessage="Best Dates"
            />
          </h3>
          <div className="space-y-1">
            {topDates.map((d) => {
              const allCount = d.available.length + d.ifNeeded.length
              const ratio = allCount / total
              return (
                <div key={d.eventDateId} className="flex items-center gap-2">
                  <span className="text-sm font-medium w-28 flex-shrink-0">
                    {intl.formatDate(new Date(d.date + 'T12:00:00'), {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden flex">
                    {d.available.length > 0 && (
                      <div
                        className="h-full bg-green-400"
                        style={{
                          width: `${(d.available.length / total) * 100}%`
                        }}
                      />
                    )}
                    {d.ifNeeded.length > 0 && (
                      <div
                        className="h-full bg-yellow-300"
                        style={{
                          width: `${(d.ifNeeded.length / total) * 100}%`
                        }}
                      />
                    )}
                  </div>
                  <span className="text-xs text-gray-500 w-10 text-right flex-shrink-0">
                    {allCount}/{total}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {suggestionsOpen && <DateSuggestion eventId={eventId} />}
    </div>
  )
}

function isAuthenticated(
  data: components['schemas']['EventView']
): data is AuthenticatedView {
  return data.role === 'participant' || data.role === 'host'
}

function ShareLinkManager({ eventId }: { eventId: string }) {
  const intl = useIntl()
  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/events/{eventId}/share-links', {
        params: { path: { eventId } },
        body: {}
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', eventId] })
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async (linkId: string) => {
      await api.DELETE('/events/{eventId}/share-links/{linkId}', {
        params: { path: { eventId, linkId } }
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', eventId] })
    }
  })

  const { data } = useQuery({
    queryKey: ['event', eventId],
    queryFn: async () => {
      const { data, error } = await api.GET('/events/{eventId}', {
        params: { path: { eventId } }
      })
      if (error) throw error
      return data
    }
  })

  const shareLinks = data?.role === 'host' ? data.shareLinks : []

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/events/${eventId}/${token}`
    navigator.clipboard.writeText(url)
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => createMutation.mutate()}
        disabled={createMutation.isPending}
        className="text-sm px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50 cursor-pointer"
      >
        <FormattedMessage
          id="settings.createLink"
          defaultMessage="Create link"
        />
      </button>
      {shareLinks.length === 0 && (
        <p className="text-xs text-gray-400">
          <FormattedMessage
            id="settings.noLinks"
            defaultMessage="No invite links yet. Create one to let people join."
          />
        </p>
      )}
      {shareLinks.map((link) => (
        <div key={link.id} className="flex items-center gap-2 text-sm">
          <span className="text-xs text-gray-400 flex-shrink-0">
            {intl.formatDate(new Date(link.createdAt), { dateStyle: 'medium' })}{' '}
            {intl.formatTime(new Date(link.createdAt), { timeStyle: 'short' })}
          </span>
          <button
            onClick={() => copyLink(link.token)}
            className="text-xs px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded border cursor-pointer"
          >
            <FormattedMessage id="settings.copyLink" defaultMessage="Copy" />
          </button>
          <button
            onClick={() => deleteMutation.mutate(link.id)}
            disabled={deleteMutation.isPending}
            className="text-xs px-2 py-0.5 text-red-600 hover:bg-red-50 rounded border cursor-pointer"
          >
            <FormattedMessage
              id="settings.revokeLink"
              defaultMessage="Revoke"
            />
          </button>
        </div>
      ))}
    </div>
  )
}

function DateSuggestion({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient()
  const [date, setDate] = useState('')

  const suggestMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/events/{eventId}/dates', {
        params: { path: { eventId } },
        body: { date }
      })
      if (error) throw error
    },
    onSuccess: () => {
      setDate('')
      queryClient.invalidateQueries({ queryKey: ['event', eventId] })
    }
  })

  return (
    <div className="flex gap-2 items-end max-w-md">
      <div className="flex-1">
        <label className="text-xs text-gray-500">
          <FormattedMessage
            id="event.suggestDate"
            defaultMessage="Suggest a date"
          />
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="block w-full text-sm px-2 py-1 border rounded mt-0.5 cursor-pointer"
        />
      </div>
      <button
        onClick={() => suggestMutation.mutate()}
        disabled={!date || suggestMutation.isPending}
        className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded border disabled:opacity-50 cursor-pointer"
      >
        <FormattedMessage id="event.suggestButton" defaultMessage="Suggest" />
      </button>
    </div>
  )
}

function HostSettings({
  eventId,
  event
}: {
  eventId: string
  event: AuthenticatedView & { role: 'host' }
}) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(event.title)
  const [description, setDescription] = useState(event.description ?? '')
  const [visibility, setVisibility] = useState(event.visibility.kind)
  const [suggestions, setSuggestions] = useState(event.suggestions.kind)
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updateMutation = useMutation({
    mutationFn: async (body: components['schemas']['UpdateEventRequest']) => {
      const { error } = await api.PATCH('/events/{eventId}', {
        params: { path: { eventId } },
        body
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', eventId] })
    }
  })

  const debouncedSave = useCallback(
    (body: components['schemas']['UpdateEventRequest']) => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current)
      saveTimeout.current = setTimeout(() => updateMutation.mutate(body), 600)
    },
    [updateMutation]
  )

  useEffect(
    () => () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current)
    },
    []
  )

  return (
    <details className="mb-6 border rounded p-3">
      <summary className="text-sm font-semibold text-gray-700 cursor-pointer">
        <FormattedMessage id="settings.title" defaultMessage="Event Settings" />
        {updateMutation.isPending && (
          <span className="ml-2 text-xs text-gray-400">
            <FormattedMessage id="common.saving" defaultMessage="Saving..." />
          </span>
        )}
      </summary>
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="text-xs text-gray-500">
            <FormattedMessage id="settings.fieldTitle" defaultMessage="Title" />
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              debouncedSave({ title: e.target.value })
            }}
            className="block w-full mt-0.5 px-2 py-1 text-sm border rounded"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">
            <FormattedMessage
              id="settings.fieldDescription"
              defaultMessage="Description"
            />
          </span>
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              debouncedSave({ description: e.target.value })
            }}
            rows={2}
            className="block w-full mt-0.5 px-2 py-1 text-sm border rounded resize-none"
          />
        </label>
        <div className="flex gap-4">
          <label className="block flex-1">
            <span className="text-xs text-gray-500">
              <FormattedMessage
                id="settings.fieldVisibility"
                defaultMessage="Visibility"
              />
            </span>
            <select
              value={visibility}
              onChange={(e) => {
                const v = e.target.value as 'names-visible' | 'anonymous'
                setVisibility(v)
                updateMutation.mutate({ visibility: { kind: v } })
              }}
              className="block w-full mt-0.5 px-2 py-1 text-sm border rounded cursor-pointer"
            >
              <option value="names-visible">
                {intl.formatMessage({
                  id: 'settings.visibilityNames',
                  defaultMessage: 'Show names'
                })}
              </option>
              <option value="anonymous">
                {intl.formatMessage({
                  id: 'settings.visibilityAnonymous',
                  defaultMessage: 'Anonymous'
                })}
              </option>
            </select>
          </label>
          <label className="block flex-1">
            <span className="text-xs text-gray-500">
              <FormattedMessage
                id="settings.fieldSuggestions"
                defaultMessage="Date suggestions"
              />
            </span>
            <select
              value={suggestions}
              onChange={(e) => {
                const s = e.target.value as 'open' | 'closed'
                setSuggestions(s)
                updateMutation.mutate({ suggestions: { kind: s } })
              }}
              className="block w-full mt-0.5 px-2 py-1 text-sm border rounded cursor-pointer"
            >
              <option value="open">
                {intl.formatMessage({
                  id: 'settings.suggestionsOpen',
                  defaultMessage: 'Anyone can suggest'
                })}
              </option>
              <option value="closed">
                {intl.formatMessage({
                  id: 'settings.suggestionsClosed',
                  defaultMessage: 'Host only'
                })}
              </option>
            </select>
          </label>
        </div>
        <div>
          <span className="text-xs text-gray-500 block mb-1">
            <FormattedMessage
              id="settings.inviteLinks"
              defaultMessage="Invite Links"
            />
          </span>
          <ShareLinkManager eventId={eventId} />
        </div>
      </div>
    </details>
  )
}

function CopyMyLink({ eventId }: { eventId: string }) {
  const [copied, setCopied] = useState(false)
  const token = getToken(eventId)
  if (!token) return null

  const copy = () => {
    navigator.clipboard.writeText(
      `${window.location.origin}/events/${eventId}/${token}`
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <p className="text-xs text-gray-400">
      <button
        onClick={copy}
        className="text-blue-500 hover:text-blue-700 hover:underline cursor-pointer"
      >
        {copied ? (
          <FormattedMessage
            id="event.copyLinkCopied"
            defaultMessage="Copied!"
          />
        ) : (
          <FormattedMessage
            id="event.copyLink"
            defaultMessage="Copy your personal link"
          />
        )}
      </button>{' '}
      <FormattedMessage
        id="event.copyLinkSuffix"
        defaultMessage="to edit your availability later"
      />
    </p>
  )
}

function HowItWorks({
  dialogRef
}: {
  dialogRef: RefObject<HTMLDialogElement | null>
}) {
  return (
    <dialog
      ref={dialogRef}
      className="rounded-lg p-0 max-w-sm w-full backdrop:bg-black/40 m-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) dialogRef.current?.close()
      }}
    >
      <div className="p-5 space-y-4 bg-white">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">
            <FormattedMessage
              id="howItWorks.title"
              defaultMessage="How it works"
            />
          </h2>
          <button
            onClick={() => dialogRef.current?.close()}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none cursor-pointer"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="space-y-3 text-sm text-gray-600">
          <div>
            <p className="font-medium text-gray-700 mb-1">
              <FormattedMessage
                id="howItWorks.markAvailability"
                defaultMessage="Mark your availability"
              />
            </p>
            <div className="flex items-center gap-3 text-xs mb-1">
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 bg-green-400 rounded-sm" />{' '}
                <FormattedMessage
                  id="howItWorks.available"
                  defaultMessage="Available"
                />
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 bg-yellow-300 rounded-sm" />{' '}
                <FormattedMessage
                  id="howItWorks.ifNeeded"
                  defaultMessage="If needed"
                />
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 bg-gray-100 border border-gray-200 rounded-sm" />{' '}
                <FormattedMessage
                  id="howItWorks.empty"
                  defaultMessage="Empty"
                />
              </span>
            </div>
            <p className="text-xs text-gray-500 hidden sm:block">
              <FormattedMessage
                id="howItWorks.clickInstruction"
                defaultMessage="Click a slot to mark available, right-click for if needed. Drag to paint multiple slots."
              />
            </p>
            <p className="text-xs text-gray-500 sm:hidden">
              <FormattedMessage
                id="howItWorks.tapInstruction"
                defaultMessage="Tap a slot to cycle through states. Drag to paint multiple slots."
              />
            </p>
          </div>

          <div>
            <p className="font-medium text-gray-700 mb-1">
              <FormattedMessage
                id="howItWorks.dayHeaders"
                defaultMessage="Day headers"
              />
            </p>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs px-2 py-1 bg-green-100 text-green-900 rounded">
                Mon 5
              </span>
              <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-900 rounded">
                Tue 6
              </span>
              <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded">
                Wed 7
              </span>
            </div>
            <p className="text-xs text-gray-500">
              <FormattedMessage
                id="howItWorks.dayHeaderInstruction"
                defaultMessage="Click a day header to fill or clear the entire column."
              />
            </p>
          </div>

          <div>
            <p className="font-medium text-gray-700 mb-1">
              <FormattedMessage
                id="howItWorks.yourName"
                defaultMessage="Your name"
              />
            </p>
            <p className="text-xs text-gray-500">
              <FormattedMessage
                id="howItWorks.yourNameDescription"
                defaultMessage="The name you enter is shown to other participants next to your availability."
              />
            </p>
          </div>

          <div>
            <p className="font-medium text-gray-700 mb-1">
              <FormattedMessage
                id="howItWorks.personalLink"
                defaultMessage="Your personal link"
              />
            </p>
            <p className="text-xs text-gray-500">
              <FormattedMessage
                id="howItWorks.personalLinkDescription"
                defaultMessage="Your link is the only way to return and edit your response. Copy it and keep it safe."
              />
            </p>
          </div>

          <div>
            <p className="font-medium text-gray-700 mb-1">
              <FormattedMessage
                id="howItWorks.groupView"
                defaultMessage="Group view"
              />
            </p>
            <div className="flex items-center gap-2 mb-1">
              <div className="flex h-3 w-24 rounded-full overflow-hidden">
                <div className="bg-green-400 h-full" style={{ width: '60%' }} />
                <div
                  className="bg-yellow-300 h-full"
                  style={{ width: '20%' }}
                />
                <div className="bg-gray-100 h-full" style={{ width: '20%' }} />
              </div>
              <span className="text-[10px] text-gray-400">4/5</span>
            </div>
            <p className="text-xs text-gray-500">
              <FormattedMessage
                id="howItWorks.groupViewDescription"
                defaultMessage="The heatmap below your grid shows everyone's combined availability. Tap a slot to see who's available."
              />
            </p>
          </div>
        </div>
      </div>
    </dialog>
  )
}

function SpectatorView({
  data
}: {
  data: components['schemas']['PublicEventView']
}) {
  const intl = useIntl()
  const columns: GridColumn[] = data.dates.map((d) => ({
    eventDateId: d.id,
    date: d.date
  }))
  const rows = generateSlotRows(data.timeSlotConfig)

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="mb-4">
        <h1 className="text-xl font-bold">{data.title}</h1>
        {data.description && (
          <p className="text-gray-600 text-sm mt-0.5">{data.description}</p>
        )}
        <p className="text-xs text-gray-400 mt-1">
          {columns.length > 0 && (
            <>
              {intl.formatDate(new Date(columns[0].date + 'T12:00:00'), {
                month: 'short',
                day: 'numeric'
              })}
              {columns.length > 1 && (
                <>
                  {' '}
                  –{' '}
                  {intl.formatDate(
                    new Date(columns[columns.length - 1].date + 'T12:00:00'),
                    { month: 'short', day: 'numeric' }
                  )}
                </>
              )}
              {' · '}
            </>
          )}
          {data.timezone}
        </p>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        <FormattedMessage
          id="event.spectatorNotice"
          defaultMessage="You are viewing this event as a spectator. To participate, you need an invite link from the host."
        />
      </p>

      {columns.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">
            <FormattedMessage
              id="event.groupAvailability"
              defaultMessage="Group's availability"
            />
          </h2>
          <HeatmapView
            columns={columns}
            rows={rows}
            participants={[]}
            namesVisible={false}
            weekIndex={0}
          />
        </section>
      )}
    </div>
  )
}

export function EventView({ eventId }: { eventId: string }) {
  const intl = useIntl()
  useEventWebSocket(eventId)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['event', eventId],
    queryFn: async () => {
      const { data, error } = await api.GET('/events/{eventId}', {
        params: { path: { eventId } }
      })
      if (error) throw error
      return data
    }
  })

  const myData = useQuery({
    queryKey: ['event', eventId, 'me'],
    queryFn: async () => {
      const { data, error } = await api.GET('/events/{eventId}/me', {
        params: { path: { eventId } }
      })
      if (error) throw error
      return data
    },
    enabled: !!data && isAuthenticated(data)
  })

  const howItWorksRef = useRef<HTMLDialogElement>(null)
  const [localEntries, setLocalEntries] = useState<SlotEntry[] | null>(null)
  const [weekIndex, setWeekIndex] = useState(0)
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const entries: SlotEntry[] = useMemo(() => {
    if (localEntries !== null) return localEntries
    if (!myData.data?.availability) return []
    return myData.data.availability.map((a) => ({
      eventDateId: a.eventDateId,
      slot: a.slot,
      state:
        a.kind === 'available' ? ('available' as const) : ('if-needed' as const)
    }))
  }, [localEntries, myData.data])

  const saveMutation = useMutation({
    mutationFn: async (newEntries: SlotEntry[]) => {
      await api.PUT('/events/{eventId}/me/availability', {
        params: { path: { eventId } },
        body: {
          entries: newEntries.map((e) => ({
            kind:
              e.state === 'available'
                ? ('available' as const)
                : ('if-needed' as const),
            eventDateId: e.eventDateId,
            slot: e.slot
          }))
        }
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['event', eventId] })
      await queryClient.invalidateQueries({
        queryKey: ['event', eventId, 'me']
      })
      setLocalEntries(null)
    }
  })

  const nameTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nameMutation = useMutation({
    mutationFn: async (name: string) => {
      await api.PATCH('/events/{eventId}/me', {
        params: { path: { eventId } },
        body: { name }
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', eventId] })
      queryClient.invalidateQueries({ queryKey: ['event', eventId, 'me'] })
    }
  })

  const handleNameChange = useCallback(
    (name: string) => {
      if (nameTimeout.current) clearTimeout(nameTimeout.current)
      nameTimeout.current = setTimeout(() => {
        if (name.trim()) nameMutation.mutate(name.trim())
      }, 600)
    },
    [nameMutation]
  )

  const handleChange = useCallback(
    (newEntries: SlotEntry[]) => {
      setLocalEntries(newEntries)
      if (saveTimeout.current) clearTimeout(saveTimeout.current)
      saveTimeout.current = setTimeout(() => {
        saveMutation.mutate(newEntries)
      }, 800)
    },
    [saveMutation]
  )

  useEffect(() => {
    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current)
    }
  }, [])

  const columns: GridColumn[] = useMemo(() => {
    if (!data || !isAuthenticated(data)) return []
    return data.dates.map((d) => ({ eventDateId: d.id, date: d.date }))
  }, [data])

  const weeks = useMemo(
    () => buildCalendarWeeks(columns, intl.locale),
    [columns, intl.locale]
  )

  useEffect(() => {
    if (data && isAuthenticated(data)) {
      trackEvent(eventId, data.title)
    }
  }, [data, eventId])

  if (isLoading)
    return (
      <div className="p-4">
        <FormattedMessage id="common.loading" defaultMessage="Loading..." />
      </div>
    )
  if (!data)
    return (
      <div className="p-4">
        <FormattedMessage
          id="event.notFound"
          defaultMessage="Event not found"
        />
      </div>
    )
  if (data.role === 'public') return <SpectatorView data={data} />

  const authedData = data as AuthenticatedView

  const rows = generateSlotRows(authedData.timeSlotConfig)
  const namesVisible = authedData.visibility.kind === 'names-visible'
  const suggestionsOpen = authedData.suggestions.kind === 'open'

  return (
    <div className="max-w-5xl mx-auto p-4 mb-10">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">{authedData.title}</h1>
            {authedData.description && (
              <p className="text-gray-600 text-sm mt-0.5">
                {authedData.description}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              {columns.length > 0 && (
                <>
                  {intl.formatDate(new Date(columns[0].date + 'T12:00:00'), {
                    month: 'short',
                    day: 'numeric'
                  })}
                  {columns.length > 1 && (
                    <>
                      {' '}
                      –{' '}
                      {intl.formatDate(
                        new Date(
                          columns[columns.length - 1].date + 'T12:00:00'
                        ),
                        { month: 'short', day: 'numeric' }
                      )}
                    </>
                  )}
                  {' · '}
                </>
              )}
              {authedData.timezone}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <ThemeSwitcher />
            <LocaleSwitcher />
            <button
              onClick={() => howItWorksRef.current?.showModal()}
              className="w-6 h-6 rounded-full border border-gray-300 text-gray-400 hover:text-gray-600 hover:border-gray-400 text-sm flex items-center justify-center cursor-pointer"
              aria-label="How it works"
            >
              ?
            </button>
          </div>
        </div>
      </div>
      <HowItWorks dialogRef={howItWorksRef} />

      {/* Host settings */}
      {data.role === 'host' && <HostSettings eventId={eventId} event={data} />}

      {/* Your availability */}
      <section className="mb-8">
        <div className="flex gap-x-4 items-end">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">
            <FormattedMessage
              id="event.yourAvailability"
              defaultMessage="Your Availability"
            />
          </h2>
          {weeks.length > 1 && (
            <WeekMinimap
              weeks={weeks}
              entries={entries}
              currentIndex={weekIndex}
              onSelect={setWeekIndex}
            />
          )}
        </div>
        <AvailabilityGrid
          columns={columns}
          timeSlotConfig={authedData.timeSlotConfig}
          entries={entries}
          onChange={handleChange}
          weekIndex={weekIndex}
          onWeekIndexChange={setWeekIndex}
        />
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 justify-between">
          {myData.data && (
            <>
              <span className="flex items-center gap-1.5">
                <FormattedMessage
                  id="event.respondingAs"
                  defaultMessage="Responding as"
                />
                <input
                  type="text"
                  defaultValue={myData.data.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="px-1.5 py-0.5 border rounded w-28 text-gray-600"
                  placeholder={intl.formatMessage({
                    id: 'event.yourNamePlaceholder',
                    defaultMessage: 'Your name'
                  })}
                />
              </span>
              {(saveMutation.isPending || nameMutation.isPending) && (
                <span className="text-gray-400">
                  <FormattedMessage
                    id="common.saving"
                    defaultMessage="Saving..."
                  />
                </span>
              )}
              <span className="text-gray-300">·</span>
            </>
          )}
          <CopyMyLink eventId={eventId} />
        </div>
      </section>

      {/* Group section */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">
          <FormattedMessage
            id="event.groupAvailability"
            defaultMessage="Group"
          />
        </h2>
        <GroupSummary
          columns={columns}
          participants={authedData.participants}
          namesVisible={namesVisible}
          isHost={data.role === 'host'}
          eventId={eventId}
          suggestionsOpen={suggestionsOpen}
        />
        <HeatmapView
          columns={columns}
          rows={rows}
          participants={authedData.participants}
          namesVisible={namesVisible}
          weekIndex={weekIndex}
        />
      </section>
    </div>
  )
}
