import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { useEventWebSocket } from '@/shared/api/ws'
import { getToken } from '@/shared/api/token'
import { generateSlotRows } from '@/shared/grid/slots'
import { AvailabilityGrid } from '@/features/grid/AvailabilityGrid'
import { HeatmapView } from '@/features/results/HeatmapView'
import type { SlotEntry, GridColumn } from '@/features/grid/types'
import type { components } from '@/shared/api/generated/schema'

type AuthenticatedView = components['schemas']['ParticipantEventView'] | components['schemas']['HostEventView']

function isAuthenticated(
  data: components['schemas']['EventView'],
): data is AuthenticatedView {
  return data.role === 'participant' || data.role === 'host'
}

function ShareLinkManager({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('')

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/events/{eventId}/share-links', {
        params: { path: { eventId } },
        body: { label: label || undefined },
      })
      if (error) throw error
    },
    onSuccess: () => {
      setLabel('')
      queryClient.invalidateQueries({ queryKey: ['event', eventId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (linkId: string) => {
      await api.DELETE('/events/{eventId}/share-links/{linkId}', {
        params: { path: { eventId, linkId } },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', eventId] })
    },
  })

  const { data } = useQuery({
    queryKey: ['event', eventId],
    queryFn: async () => {
      const { data, error } = await api.GET('/events/{eventId}', {
        params: { path: { eventId } },
      })
      if (error) throw error
      return data
    },
  })

  const shareLinks = data?.role === 'host' ? data.shareLinks : []

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/events/${eventId}/${token}`
    navigator.clipboard.writeText(url)
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="flex-1 text-sm px-2 py-1 border rounded"
        />
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="text-sm px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
        >
          Create link
        </button>
      </div>
      {shareLinks.length === 0 && (
        <p className="text-xs text-gray-400">No invite links yet. Create one to let people join.</p>
      )}
      {shareLinks.map((link) => (
        <div key={link.id} className="flex items-center gap-2 text-sm">
          <span className="truncate flex-1 text-gray-600">
            {link.label || 'Invite link'}
          </span>
          <button
            onClick={() => copyLink(link.token)}
            className="text-xs px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded border"
          >
            Copy
          </button>
          <button
            onClick={() => deleteMutation.mutate(link.id)}
            disabled={deleteMutation.isPending}
            className="text-xs px-2 py-0.5 text-red-600 hover:bg-red-50 rounded border"
          >
            Revoke
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
        body: { date },
      })
      if (error) throw error
    },
    onSuccess: () => {
      setDate('')
      queryClient.invalidateQueries({ queryKey: ['event', eventId] })
    },
  })

  return (
    <div className="flex gap-2 items-end">
      <div className="flex-1">
        <label className="text-xs text-gray-500">Suggest a date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="block w-full text-sm px-2 py-1 border rounded mt-0.5"
        />
      </div>
      <button
        onClick={() => suggestMutation.mutate()}
        disabled={!date || suggestMutation.isPending}
        className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded border disabled:opacity-50"
      >
        Suggest
      </button>
    </div>
  )
}

function HostSettings({ eventId, event }: { eventId: string; event: AuthenticatedView & { role: 'host' } }) {
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
        body,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', eventId] })
    },
  })

  const debouncedSave = useCallback(
    (body: components['schemas']['UpdateEventRequest']) => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current)
      saveTimeout.current = setTimeout(() => updateMutation.mutate(body), 600)
    },
    [updateMutation],
  )

  useEffect(() => () => { if (saveTimeout.current) clearTimeout(saveTimeout.current) }, [])

  return (
    <details className="mb-6 border rounded p-3">
      <summary className="text-sm font-semibold text-gray-700 cursor-pointer">
        Event Settings
        {updateMutation.isPending && <span className="ml-2 text-xs text-gray-400">Saving...</span>}
      </summary>
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="text-xs text-gray-500">Title</span>
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
          <span className="text-xs text-gray-500">Description</span>
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
            <span className="text-xs text-gray-500">Visibility</span>
            <select
              value={visibility}
              onChange={(e) => {
                const v = e.target.value as 'names-visible' | 'anonymous'
                setVisibility(v)
                updateMutation.mutate({ visibility: { kind: v } })
              }}
              className="block w-full mt-0.5 px-2 py-1 text-sm border rounded"
            >
              <option value="names-visible">Show names</option>
              <option value="anonymous">Anonymous</option>
            </select>
          </label>
          <label className="block flex-1">
            <span className="text-xs text-gray-500">Date suggestions</span>
            <select
              value={suggestions}
              onChange={(e) => {
                const s = e.target.value as 'open' | 'closed'
                setSuggestions(s)
                updateMutation.mutate({ suggestions: { kind: s } })
              }}
              className="block w-full mt-0.5 px-2 py-1 text-sm border rounded"
            >
              <option value="open">Anyone can suggest</option>
              <option value="closed">Host only</option>
            </select>
          </label>
        </div>
        <div>
          <span className="text-xs text-gray-500 block mb-1">Invite Links</span>
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
    navigator.clipboard.writeText(`${window.location.origin}/events/${eventId}/${token}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={copy}
      className="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded border flex-shrink-0"
    >
      {copied ? 'Copied!' : 'Save your link'}
    </button>
  )
}

function SpectatorView({ data }: { data: components['schemas']['PublicEventView'] }) {
  const columns: GridColumn[] = data.dates.map((d) => ({
    eventDateId: d.id,
    date: d.date,
  }))
  const rows = generateSlotRows(data.timeSlotConfig)

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="mb-4">
        <h1 className="text-xl font-bold">{data.title}</h1>
        {data.description && (
          <p className="text-gray-600 text-sm mt-0.5">{data.description}</p>
        )}
        <p className="text-xs text-gray-400 mt-1">{data.timezone}</p>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        You are viewing this event as a spectator. To participate, you need an invite link from the host.
      </p>

      {columns.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Group Availability</h2>
          <HeatmapView
            columns={columns}
            rows={rows}
            participants={[]}
            namesVisible={false}
          />
        </section>
      )}
    </div>
  )
}

export function EventView({ eventId }: { eventId: string }) {
  useEventWebSocket(eventId)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['event', eventId],
    queryFn: async () => {
      const { data, error } = await api.GET('/events/{eventId}', {
        params: { path: { eventId } },
      })
      if (error) throw error
      return data
    },
  })

  const myData = useQuery({
    queryKey: ['event', eventId, 'me'],
    queryFn: async () => {
      const { data, error } = await api.GET('/events/{eventId}/me', {
        params: { path: { eventId } },
      })
      if (error) throw error
      return data
    },
    enabled: !!data && isAuthenticated(data),
  })

  const [localEntries, setLocalEntries] = useState<SlotEntry[] | null>(null)
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const entries: SlotEntry[] = useMemo(() => {
    if (localEntries !== null) return localEntries
    if (!myData.data?.availability) return []
    return myData.data.availability.map((a) => ({
      eventDateId: a.eventDateId,
      slot: a.slot,
      state: a.kind === 'available' ? ('available' as const) : ('if-needed' as const),
    }))
  }, [localEntries, myData.data])

  const saveMutation = useMutation({
    mutationFn: async (newEntries: SlotEntry[]) => {
      await api.PUT('/events/{eventId}/me/availability', {
        params: { path: { eventId } },
        body: {
          entries: newEntries.map((e) => ({
            kind: e.state === 'available' ? ('available' as const) : ('if-needed' as const),
            eventDateId: e.eventDateId,
            slot: e.slot,
          })),
        },
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['event', eventId] })
      await queryClient.invalidateQueries({ queryKey: ['event', eventId, 'me'] })
      setLocalEntries(null)
    },
  })

  const nameTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nameMutation = useMutation({
    mutationFn: async (name: string) => {
      await api.PATCH('/events/{eventId}/me', {
        params: { path: { eventId } },
        body: { name },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', eventId] })
      queryClient.invalidateQueries({ queryKey: ['event', eventId, 'me'] })
    },
  })

  const handleNameChange = useCallback(
    (name: string) => {
      if (nameTimeout.current) clearTimeout(nameTimeout.current)
      nameTimeout.current = setTimeout(() => {
        if (name.trim()) nameMutation.mutate(name.trim())
      }, 600)
    },
    [nameMutation],
  )

  const handleChange = useCallback(
    (newEntries: SlotEntry[]) => {
      setLocalEntries(newEntries)
      if (saveTimeout.current) clearTimeout(saveTimeout.current)
      saveTimeout.current = setTimeout(() => {
        saveMutation.mutate(newEntries)
      }, 800)
    },
    [saveMutation],
  )

  useEffect(() => {
    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current)
    }
  }, [])

  if (isLoading) return <div className="p-4">Loading...</div>
  if (!data) return <div className="p-4">Event not found</div>
  if (data.role === 'public') return <SpectatorView data={data} />

  const authedData = data as AuthenticatedView

  const columns: GridColumn[] = authedData.dates.map((d) => ({
    eventDateId: d.id,
    date: d.date,
  }))

  const rows = generateSlotRows(authedData.timeSlotConfig)
  const namesVisible = authedData.visibility.kind === 'names-visible'
  const suggestionsOpen = authedData.suggestions.kind === 'open'

  return (
    <div className="max-w-5xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">{authedData.title}</h1>
          {authedData.description && (
            <p className="text-gray-600 text-sm mt-0.5">{authedData.description}</p>
          )}
          <p className="text-xs text-gray-400 mt-1">
            {authedData.timezone} · {data.role === 'host' ? 'Host' : 'Participant'}
          </p>
        </div>
        <CopyMyLink eventId={eventId} />
      </div>

      {/* Host settings */}
      {data.role === 'host' && (
        <HostSettings eventId={eventId} event={data} />
      )}

      {/* Your availability */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-700">Your Availability</h2>
            {myData.data && (
              <input
                type="text"
                defaultValue={myData.data.name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="text-sm px-1.5 py-0.5 border rounded w-32 text-gray-600"
                placeholder="Your name"
              />
            )}
          </div>
          {(saveMutation.isPending || nameMutation.isPending) && (
            <span className="text-xs text-gray-400">Saving...</span>
          )}
        </div>
        <AvailabilityGrid
          columns={columns}
          timeSlotConfig={authedData.timeSlotConfig}
          entries={entries}
          onChange={handleChange}
        />
      </section>

      {/* Date suggestion for participants */}
      {suggestionsOpen && (
        <section className="mb-6">
          <DateSuggestion eventId={eventId} />
        </section>
      )}

      {/* Heatmap results */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">
          Group Availability ({authedData.participants.length} responses)
        </h2>
        <HeatmapView
          columns={columns}
          rows={rows}
          participants={authedData.participants}
          namesVisible={namesVisible}
        />
      </section>
    </div>
  )
}
