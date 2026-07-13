// Cal.com API v2 — appointment booking for AI Reception
// Docs: https://cal.com/docs/api-reference/v2

const CAL_BASE = 'https://api.cal.com/v2'
const API_KEY  = process.env.CAL_DIY_API_KEY

function calHeaders(version = '2024-08-13') {
  return {
    'Authorization': `Bearer ${API_KEY}`,
    'cal-api-version': version,
    'Content-Type': 'application/json',
  }
}

export interface SlotResult {
  slots: { time: string; label: string }[]
  timezone: string
  error?: string
}

export interface BookingResult {
  ok: boolean
  bookingId?: number
  uid?: string
  start?: string
  meetingUrl?: string
  error?: string
}

// Returns available slots for the next N days (default 5 business days)
export async function getAvailableSlots(
  eventTypeId: number,
  timezone: string,
  daysAhead = 5
): Promise<SlotResult> {
  if (!API_KEY) return { slots: [], timezone, error: 'CAL_DIY_API_KEY not set' }

  const startTime = new Date()
  startTime.setHours(startTime.getHours() + 1, 0, 0, 0) // start from next hour
  const endTime = new Date(startTime)
  endTime.setDate(endTime.getDate() + daysAhead)

  const params = new URLSearchParams({
    startTime: startTime.toISOString(),
    endTime:   endTime.toISOString(),
    eventTypeId: String(eventTypeId),
    timeZone:  timezone,
  })

  try {
    const res = await fetch(`${CAL_BASE}/slots/available?${params}`, {
      headers: calHeaders('2024-09-23'),
    })
    const data = await res.json() as any

    if (!res.ok) return { slots: [], timezone, error: data?.error?.message ?? 'slots fetch failed' }

    // data.data.slots = { "2024-06-27": [{ time: "...", ... }], ... }
    const slotsByDay = data?.data?.slots ?? {}
    const slots: { time: string; label: string }[] = []

    for (const [day, daySlots] of Object.entries(slotsByDay)) {
      for (const s of (daySlots as any[]).slice(0, 3)) { // max 3 per day
        const dt = new Date(s.time)
        const label = dt.toLocaleString('en-US', {
          timeZone: timezone,
          weekday: 'short', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit', hour12: true,
        })
        slots.push({ time: s.time, label })
        if (slots.length >= 9) break
      }
      if (slots.length >= 9) break
    }

    return { slots, timezone }
  } catch (e: any) {
    return { slots: [], timezone, error: e.message }
  }
}

export async function createBooking(opts: {
  eventTypeId: number
  start: string        // ISO datetime
  name: string
  email: string
  phone?: string
  notes?: string
  timezone: string
}): Promise<BookingResult> {
  if (!API_KEY) return { ok: false, error: 'CAL_DIY_API_KEY not set' }

  try {
    const body: any = {
      eventTypeId: opts.eventTypeId,
      start: opts.start,
      attendee: {
        name:     opts.name,
        email:    opts.email,
        timeZone: opts.timezone,
        language: 'en',
      },
    }
    if (opts.phone || opts.notes) {
      body.metadata = {}
      if (opts.phone) body.metadata.phone = opts.phone
      if (opts.notes) body.metadata.notes = opts.notes
    }

    const res = await fetch(`${CAL_BASE}/bookings`, {
      method:  'POST',
      headers: calHeaders('2024-08-13'),
      body:    JSON.stringify(body),
    })
    const data = await res.json() as any

    if (!res.ok) return { ok: false, error: data?.error?.message ?? 'booking failed' }

    const booking = data?.data
    return {
      ok:         true,
      bookingId:  booking?.id,
      uid:        booking?.uid,
      start:      booking?.start,
      meetingUrl: booking?.meetingUrl ?? booking?.location,
    }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}
