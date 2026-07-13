import { geminiText, GEMINI_PRO } from '../tools/gemini.js'
import type { BusinessBrain }    from './types.js'

const FIRECRAWL_URL = process.env.FIRECRAWL_URL ?? 'https://api.firecrawl.dev'
const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY ?? ''

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function buildBrain(websiteUrl: string): Promise<BusinessBrain> {
  console.log(`[Brain] Scraping ${websiteUrl}...`)
  const content = await scrapeWebsite(websiteUrl)
  console.log(`[Brain] Scraped ${content.length} chars — extracting...`)
  const brain = await extractBrainData(content, websiteUrl)
  console.log(`[Brain] Done: ${brain.name} | ${brain.services.length} services | ${brain.faqs.length} FAQs`)
  return brain
}

// ─── Firecrawl: crawl up to 10 pages, fallback to single scrape ───────────────

async function scrapeWebsite(url: string): Promise<string> {
  try {
    // Try crawl first (multiple pages = more complete brain)
    const crawlRes = await fetch(`${FIRECRAWL_URL}/v1/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${FIRECRAWL_KEY}` },
      body: JSON.stringify({ url, limit: 10, scrapeOptions: { formats: ['markdown'] } }),
    })
    if (!crawlRes.ok) throw new Error(`crawl ${crawlRes.status}`)

    const { id: jobId } = await crawlRes.json() as any

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const poll = await fetch(`${FIRECRAWL_URL}/v1/crawl/${jobId}`, {
        headers: { 'Authorization': `Bearer ${FIRECRAWL_KEY}` },
      })
      const pollData = await poll.json() as any
      if (pollData.status === 'completed') {
        return (pollData.data ?? [])
          .map((p: any) => p.markdown ?? '')
          .join('\n\n---\n\n')
          .slice(0, 60000)
      }
    }
    throw new Error('crawl timeout')
  } catch (e: any) {
    console.log(`[Brain] Crawl failed (${e.message}), using single-page scrape`)
    const res = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${FIRECRAWL_KEY}` },
      body: JSON.stringify({ url, formats: ['markdown'] }),
    })
    const data = await res.json() as any
    return data.data?.markdown ?? ''
  }
}

// ─── Gemini: extract structured business data ─────────────────────────────────

async function extractBrainData(content: string, url: string): Promise<BusinessBrain> {

  const prompt = `Extract all business information from this website content. Return ONLY valid JSON.

Website: ${url}

Content:
${content.slice(0, 40000)}

Return this exact JSON structure (use null for missing fields):
{
  "name": "Business Name",
  "type": "business type (e.g. hvac, dentist, restaurant)",
  "address": "full street address",
  "phone": "main phone number",
  "email": "contact email",
  "hours": {
    "monday": "9am-5pm",
    "tuesday": "9am-5pm",
    "wednesday": "9am-5pm",
    "thursday": "9am-5pm",
    "friday": "9am-5pm",
    "saturday": "closed",
    "sunday": "closed"
  },
  "services": [
    {
      "name": "Service name",
      "price": "$X or null",
      "duration": "1 hour or null",
      "description": "brief one-line description"
    }
  ],
  "booking_url": "full URL to book online or null",
  "booking_instructions": "how to book — online form, call us, walk-in, etc.",
  "faqs": [
    { "question": "Common question?", "answer": "Concise answer." }
  ],
  "special_notes": "insurance accepted, certifications, guarantees, policies",
  "owner_phone": "direct owner/manager cell if found, else null"
}

Rules:
- Extract actual hours shown on site, not guesses
- Include all services with pricing if listed
- Generate up to 10 FAQs from page content (pricing, hours, booking, cancellation, service area, etc.)
- owner_phone: only set if clearly a direct/cell number, not the main business number`

  const text = (await geminiText(prompt, { model: GEMINI_PRO })).trim()

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Gemini returned no JSON')

  const brain = JSON.parse(jsonMatch[0]) as BusinessBrain

  // Normalize
  if (!brain.hours) brain.hours = {}
  if (!brain.services) brain.services = []
  if (!brain.faqs) brain.faqs = []

  return brain
}

// ─── Build system prompt from brain ──────────────────────────────────────────

export function buildSystemPrompt(brain: BusinessBrain): string {
  const hoursText = Object.entries(brain.hours).length > 0
    ? Object.entries(brain.hours)
        .map(([day, h]) => `  ${day.charAt(0).toUpperCase() + day.slice(1)}: ${h}`)
        .join('\n')
    : '  Please call for current hours'

  const servicesText = brain.services.length > 0
    ? brain.services.map(s => {
        let line = `  • ${s.name}`
        if (s.price) line += ` — ${s.price}`
        if (s.duration) line += ` (${s.duration})`
        if (s.description) line += `. ${s.description}`
        return line
      }).join('\n')
    : '  See website for full service list'

  const bookingText = [
    brain.booking_url ? `Online booking: ${brain.booking_url}` : null,
    brain.booking_instructions ?? null,
  ].filter(Boolean).join('\n  ') || 'Take caller name and number, let them know someone will follow up to confirm.'

  const faqText = brain.faqs.length > 0
    ? `FREQUENTLY ASKED QUESTIONS:\n${brain.faqs.map(f => `  Q: ${f.question}\n  A: ${f.answer}`).join('\n\n')}`
    : ''

  return `You are the AI receptionist for ${brain.name}, a ${brain.type} business.
${brain.address ? `Address: ${brain.address}` : ''}${brain.phone ? `\nPhone: ${brain.phone}` : ''}${brain.email ? `\nEmail: ${brain.email}` : ''}

HOURS:
${hoursText}

SERVICES:
${servicesText}

BOOKING:
  ${bookingText}

${faqText ? faqText + '\n\n' : ''}${brain.special_notes ? `IMPORTANT NOTES:\n  ${brain.special_notes}\n\n` : ''}VOICE & SPEECH PATTERNS (you are speaking aloud — sound human, not robotic):
- Thinking fillers when processing: "Hmm, let me see...", "Oh, let me check that...", "One moment..."
- Backchannels while caller talks: "Uh-huh", "Mm-hmm", "Right, right", "I see" — shows you're listening
- Natural hesitations are good: occasional "um" or "uh" when transitioning between thoughts
- After caller finishes: pause 1 beat, THEN respond — never cut in or answer instantly
- Warm acknowledgment before answering: "Oh sure!", "Of course!", "Absolutely, so..." or "Got it —"
- If silence after your question > 3 sec: "Take your time, no rush at all"
- Spell emails back with gaps between letters: "So that's... p... a... v... a... n... at gmail... dot com?"
- Confirm bookings with a pause then: "Perfect — let me lock that in..." then proceed
- Avoid sounding like you're reading — vary your pacing, go slower on important details
- Keep responses SHORT — 1-2 sentences max. Phone call, not a presentation

TOOLS — WHEN TO USE EACH:

check_availability: When caller wants to book, schedule, or asks about availability
book_appointment: After caller picks a slot — confirm name, email, and phone first
  - Repeat the chosen day/time back before booking: "Great, Wednesday July 1st at 9 AM — locking that in."
  - You'll have the caller's phone number — confirm it with them: "I have [number] on file, is that right?"
  - Email is required to book — always ask if not provided. Spell it back letter by letter since
    voice capture of emails is error-prone: "Let me make sure I've got that — p, a, v, a, n, at gmail dot com?"
  - After booking: "You're all set! You'll get a confirmation email shortly."

take_message: When caller wants to leave a message, after-hours, or can't book now
escalate_to_human: When caller is upset, asks for a human/manager, or has an emergency
end_call: Call this AFTER saying goodbye — whenever the call is naturally wrapping up
  - Say goodbye warmly first: "Thanks so much for calling, have a wonderful day!"
  - Then call end_call — don't leave the line open awkwardly

RULES:
- Greet warmly: "Thanks for calling ${brain.name}! How can I help you today?"
- Only use info above — never invent prices, availability, or facts
- If asked if you're AI: "I'm an AI assistant for ${brain.name} — I'm here to help!"
- Never discuss competitors, never promise results, never share owner's personal contact
- After-hours: let them know hours and offer to take a message`
}
