import type { WebSocketServer } from 'ws'
import WebSocket from 'ws'
import { GeminiLiveSession } from './gemini-live.js'
import { twilioToGeminiAudio, geminiToTwilioAudio } from './audio-codec.js'
import { getReceptionConfigById, insertCallLog } from './db.js'
import { sendSMS } from '../agents/sms-outreach.js'
import { getAvailableSlots, createBooking } from './cal-booking.js'
import { callMeta } from './call-context.js'
import { consumePending } from './call-warmup.js'

const CAL_EVENT_TYPE_ID = parseInt(process.env.CAL_EVENT_TYPE_ID ?? '6126925')
const CAL_TIMEZONE      = process.env.CAL_TIMEZONE ?? 'America/Los_Angeles'
const BASE_URL          = process.env.RECEPTION_BASE_URL ?? 'http://localhost:3030'

// Bridges Twilio Media Streams ↔ Gemini Live
// Flow: inbound call → TwiML <Stream> → WebSocket here → Gemini Live → audio back to Twilio

export function attachTwilioRelay(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket, req) => {
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams
    let configId = params.get('config')

    let gemini: GeminiLiveSession | null = null
    let streamSid: string | null = null
    let callSid: string | null = null
    let callerPhone: string | null = null
    let configData: Awaited<ReturnType<typeof getReceptionConfigById>> = null
    let callStart: number = Date.now()
    let transcript: string[] = []
    let escalated = false
    let takenMessage: string | undefined
    let greetingReady = false
    let callEnding = false
    let callerAudioReceived = false  // true only after real caller audio bytes arrive

    // Idle detection — prompt caller after silence, end call if no response
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    let idleWarned = false
    const IDLE_WARN_MS = 15_000  // ask if still there after 15s silence
    const IDLE_END_MS  = 10_000  // say goodbye + end_call after 10s more

    function clearIdle() {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
    }

    function scheduleIdle() {
      clearIdle()
      idleWarned = false
      idleTimer = setTimeout(() => {
        if (callEnding) return
        idleWarned = true
        gemini?.sendText('The caller has been silent for a few seconds. Gently ask if they are still there — one short sentence only.')
        idleTimer = setTimeout(() => {
          if (callEnding) return
          gemini?.sendText('Still no response from caller. Say a warm goodbye: "Sounds like you may have stepped away — feel free to call back anytime, we\'re here 24/7! Take care." Then use the end_call tool.')
        }, IDLE_END_MS)
      }, IDLE_WARN_MS)
    }

    // Twilio keepalive — send mark event every 30s to prevent 60s WebSocket timeout
    let twilioKeepalive: ReturnType<typeof setInterval> | null = null

    function startTwilioKeepalive() {
      twilioKeepalive = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN || !streamSid || callEnding) return
        ws.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: 'keepalive' } }))
      }, 30_000)
    }

    function stopAll() {
      clearIdle()
      if (twilioKeepalive) { clearInterval(twilioKeepalive); twilioKeepalive = null }
    }

    ws.on('message', async (raw: Buffer) => {
      let msg: any
      try { msg = JSON.parse(raw.toString()) } catch { return }

      switch (msg.event) {
        case 'connected':
          console.log(`[Relay] Twilio connected — config: ${configId}`)
          break

        case 'start': {
          streamSid   = msg.start?.streamSid ?? null
          callSid     = msg.start?.callSid ?? null
          callerPhone = msg.start?.customParameters?.caller ?? null
          if (!configId) configId = msg.start?.customParameters?.config ?? null

          if (!configId) {
            console.error('[Relay] No configId in start event — missing <Parameter name="config">')
            ws.close()
            return
          }

          callStart = Date.now()
          transcript = []
          escalated = false
          takenMessage = undefined
          greetingReady = false
          callEnding = false

          const meta = callSid ? callMeta.get(callSid) : undefined

          // Callbacks defined here — reference outer let-variables by closure
          const callbacks = {
            onReady: () => {
              console.log(`[Relay] Gemini ready — ${configData!.business_name}`)

              // Start call recording via Twilio REST API (works with Media Streams)
              const sid  = process.env.TWILIO_ACCOUNT_SID
              const auth = process.env.TWILIO_AUTH_TOKEN
              if (sid && auth && callSid) {
                fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${callSid}/Recordings.json`, {
                  method:  'POST',
                  headers: {
                    Authorization:  `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  body: 'RecordingChannels=dual',
                }).then(r => {
                  if (r.ok) console.log('[Relay] Recording started')
                  else r.json().then((e: any) => console.warn('[Relay] Recording start failed:', e?.message))
                }).catch(e => console.warn('[Relay] Recording start error:', e.message))
              }

              let greeting: string
              if (meta?.isOutbound) {
                const nameCtx  = meta.leadName ? ` You're calling ${meta.leadName}.` : ''
                const demoCtx  = meta.demoUrl  ? ` Their demo site is at ${meta.demoUrl}.` : ''
                const trigCtx  = meta.triggerType === 'email_click' ? ' They clicked our email, so they showed interest.'
                               : meta.triggerType === 'sms_reply'   ? ' They replied to our SMS, so they showed interest.'
                               : meta.triggerType === 'form_submit' ? ' They just submitted our contact form.'
                               : ''
                greeting = `You just placed an outbound call.${nameCtx}${demoCtx}${trigCtx} Introduce yourself warmly as an AI assistant from ${configData!.business_name}, mention you're following up on their interest, and ask how you can help. Keep it natural and brief.`
              } else {
                // Caller heard "Hi there! Please hold for just a moment." via Twilio Say — don't repeat it
                const phoneCtx = callerPhone ? ` Caller's phone: ${callerPhone} (confirm before using).` : ''
                greeting = `[CALL CONNECTED] Say your opening line NOW. Wait for their response before doing anything else.${phoneCtx}`
              }
              gemini?.sendText(greeting)
              // 800ms gate: enough for Gemini's first audio chunk before forwarding caller audio
              setTimeout(() => { greetingReady = true }, 800)
              // Start Twilio keepalive immediately; delay idle detection 12s so greeting + hook
              // question have time to finish playing before the silence clock starts
              startTwilioKeepalive()
              setTimeout(() => scheduleIdle(), 12_000)
            },

            onClose:    () => console.log(`[Relay] Gemini closed`),
            onError:    (e: Error) => console.error(`[Relay] Gemini error: ${e.message}`),
            onText:     (text: string) => { transcript.push(`AI: ${text}`) },

            onAudio: (pcm24Base64: string) => {
              if (ws.readyState !== WebSocket.OPEN || !streamSid || callEnding) return
              const mulaw = geminiToTwilioAudio(pcm24Base64)
              ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: mulaw } }))
            },

            onToolCall: async (name: string, args: Record<string, unknown>, callId: string) => {
              console.log(`[Relay] Tool: ${name}`, args)

              if (name === 'escalate_to_human') {
                escalated = true
                transcript.push(`[ESCALATION] ${(args as any).reason ?? ''}`)
                await notifyOwner('escalation', args as any, configData!, callerPhone)
                gemini?.respondToTool(callId, name, {
                  success: true,
                  message: 'I\'m connecting you to a team member now. Please hold for just a moment.',
                })
                const ownerPhone = configData?.brain?.owner_phone
                if (ownerPhone && callSid) {
                  setTimeout(() => liveTransfer(callSid!, ownerPhone), 3000)
                }
              }

              if (name === 'take_message') {
                // Block fake take_message calls before caller has spoken
                if (!callerAudioReceived && (Date.now() - callStart) < 20_000) {
                  console.log('[Relay] take_message BLOCKED — caller has not spoken yet')
                  gemini?.respondToTool(callId, name, {
                    success: false,
                    message: 'The caller is still on the line and has not spoken yet. Continue the conversation — ask your opening question and wait for their reply.',
                  })
                  return
                }
                const a = args as any
                takenMessage = a.message ?? ''
                transcript.push(`[MESSAGE] ${takenMessage}`)
                await notifyOwner('message', a, configData!, callerPhone)

                // Send confirmation SMS + email to caller
                const destPhone = a.caller_phone ?? callerPhone
                const destEmail = a.caller_email
                const callerName = a.caller_name ?? 'there'
                let smsSent = false, emailSent = false

                if (destPhone) smsSent = await sendCallerConfirmationSMS(destPhone, callerName)
                if (destEmail) emailSent = await sendCallerConfirmationEmail(destEmail, callerName)

                console.log(`[Relay] Caller confirmations — SMS: ${smsSent}, Email: ${emailSent}`)

                gemini?.respondToTool(callId, name, {
                  success: true,
                  smsSent,
                  emailSent,
                  nextStep: `Lead recorded. ${smsSent ? `Confirmation text sent to ${destPhone}.` : ''} ${emailSent ? `Confirmation email sent to ${destEmail}.` : ''} Now: (1) Tell the caller you just ${smsSent ? 'texted' : emailSent ? 'emailed' : 'noted'} their confirmation. (2) Ask if they'd like to book a quick 15-minute intro call with our founder Pavan — use check_availability if yes. (3) Ask "Is there anything else I can help you with before I let you go?" and wait for any questions. (4) After they're satisfied, say the closing line and call end_call.`,
                })
              }

              if (name === 'check_availability') {
                console.log(`[Relay] Checking Cal.com availability`)
                const result = await getAvailableSlots(CAL_EVENT_TYPE_ID, CAL_TIMEZONE)
                if (result.error || result.slots.length === 0) {
                  gemini?.respondToTool(callId, name, {
                    success: false,
                    message: result.error ?? 'No available slots found in the next 5 days.',
                    slots:   [],
                  })
                } else {
                  const slotList = result.slots.map((s, i) => `${i + 1}. ${s.label}`).join('\n')
                  gemini?.respondToTool(callId, name, {
                    success: true,
                    message: `Here are the next available slots (${result.timezone}):`,
                    slots:   result.slots,
                    slotList,
                  })
                }
              }

              if (name === 'end_call') {
                // Block premature hang-ups before any real conversation
                if (!callerAudioReceived && (Date.now() - callStart) < 20_000) {
                  console.log('[Relay] end_call BLOCKED — caller has not spoken yet')
                  gemini?.respondToTool(callId, name, {
                    success: false,
                    message: 'Do not end the call yet — the caller is still there. Ask your opening question and wait for their response.',
                  })
                  return
                }
                console.log(`[Relay] Gemini ending call gracefully`)
                callEnding = true
                stopAll()
                setTimeout(async () => {
                  const sid  = process.env.TWILIO_ACCOUNT_SID
                  const auth = process.env.TWILIO_AUTH_TOKEN
                  if (sid && auth && callSid) {
                    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${callSid}.json`, {
                      method:  'POST',
                      headers: {
                        Authorization:  `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                      },
                      body: 'Status=completed',
                    }).catch(e => console.error('[Relay] hangup failed:', e.message))
                  }
                }, 8000)  // 8s: enough for goodbye audio to fully play before hangup
              }

              if (name === 'book_appointment') {
                const a = args as any
                console.log(`[Relay] Booking appointment for ${a.caller_name} at ${a.slot_time}`)
                const result = await createBooking({
                  eventTypeId: CAL_EVENT_TYPE_ID,
                  start:       a.slot_time,
                  name:        a.caller_name,
                  email:       a.caller_email,
                  phone:       a.caller_phone ?? callerPhone ?? undefined,
                  notes:       a.notes,
                  timezone:    CAL_TIMEZONE,
                })
                if (!result.ok) {
                  gemini?.respondToTool(callId, name, { success: false, error: result.error })
                } else {
                  transcript.push(`[BOOKING] ${a.caller_name} booked at ${result.start} | ID:${result.bookingId}`)
                  gemini?.respondToTool(callId, name, {
                    success:    true,
                    bookingId:  result.bookingId,
                    start:      result.start,
                    meetingUrl: result.meetingUrl,
                    message:    `Appointment confirmed for ${a.caller_name} at ${result.start}.`,
                  })
                }
              }
            },
          }

          // Try pre-warmed Gemini session (started in /voice handler while Twilio plays Say)
          const preWarm = callSid ? consumePending(callSid) : undefined
          if (preWarm) {
            try {
              const warm = await preWarm
              configData = warm.configData
              console.log(`[Relay] Pre-warmed session ready — ${configData.business_name} | caller: ${callerPhone ?? 'unknown'}`)
              gemini = warm.session
              gemini.setCallbacks(callbacks)
              // setCallbacks fires onReady immediately if already connected, else waits for onopen
            } catch (e: any) {
              console.error(`[Relay] Pre-warm failed: ${e.message} — falling back to fresh connect`)
            }
          }

          if (!gemini) {
            configData = await getReceptionConfigById(configId)
            if (!configData) {
              console.error(`[Relay] Config ${configId} not found`)
              ws.close()
              return
            }
            console.log(`[Relay] Call started (fresh connect) — ${configData.business_name} | caller: ${callerPhone ?? 'unknown'}`)
            gemini = new GeminiLiveSession(callbacks)
            try {
              await gemini.connect(configData.system_prompt)
            } catch (e: any) {
              console.error(`[Relay] Gemini connect failed: ${e.message}`)
              ws.close()
            }
          }
          break
        }

        case 'media': {
          if (!gemini || !msg.media?.payload || !greetingReady) break
          const pcm16 = twilioToGeminiAudio(msg.media.payload)
          gemini.sendAudio(pcm16)
          callerAudioReceived = true
          // Caller is active — reset idle timer
          scheduleIdle()
          break
        }

        case 'stop': {
          stopAll()
          const durationSec = Math.round((Date.now() - callStart) / 1000)
          console.log(`[Relay] Call ended — ${durationSec}s | caller: ${callerPhone ?? 'unknown'}`)
          gemini?.close()
          gemini = null

          if (configId && configData) {
            insertCallLog({
              configId,
              leadId:      configData.lead_id,
              caller:      callerPhone,
              durationSec,
              transcript:  transcript.join('\n'),
              escalated,
              message:     takenMessage,
            }).catch(e => console.error('[Relay] call log write failed:', e.message))
          }
          break
        }
      }
    })

    ws.on('close', () => {
      stopAll()
      gemini?.close()
      gemini = null
    })

    ws.on('error', (e) => console.error(`[Relay] Twilio WS error: ${e.message}`))
  })
}

// ─── Live transfer via Twilio call redirect ───────────────────────────────────

async function liveTransfer(callSid: string, ownerPhone: string) {
  const sid  = process.env.TWILIO_ACCOUNT_SID
  const auth = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !auth) return

  const transferUrl = `${BASE_URL}/transfer-twiml?to=${encodeURIComponent(ownerPhone)}`
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${callSid}.json`, {
      method:  'POST',
      headers: {
        Authorization:  `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ Url: transferUrl, Method: 'GET' }).toString(),
    })
    if (res.ok) {
      console.log(`[Relay] Live transfer → ${ownerPhone}`)
    } else {
      const err = await res.json() as any
      console.error(`[Relay] Live transfer failed: ${err.message}`)
    }
  } catch (e: any) {
    console.error(`[Relay] Live transfer error: ${e.message}`)
  }
}

// ─── Owner notifications — free (email via Resend + push via ntfy.sh) ────────
// No Twilio cost. Install ntfy app → subscribe to topic NTFY_TOPIC for push alerts.

async function notifyOwner(
  type: 'escalation' | 'message',
  args: { reason?: string; caller_name?: string; caller_phone?: string; caller_email?: string; message?: string },
  config: NonNullable<Awaited<ReturnType<typeof getReceptionConfigById>>>,
  callerPhone: string | null
) {
  const ownerEmail = process.env.OWNER_NOTIFY_EMAIL ?? 'pavan.harati@gmail.com'
  const ntfyTopic  = process.env.NTFY_TOPIC  // e.g. "webcrew-leads-xk92" — set in Cloud Run
  const resendKey  = process.env.RESEND_API_KEY
  const from       = process.env.OUTREACH_FROM_EMAIL ?? 'hello@webcrew.app'

  const isEscalation = type === 'escalation'
  const title = isEscalation
    ? `🚨 Escalation — ${config.business_name}`
    : `🔔 New Lead — ${args.caller_name ?? 'Unknown'} | ${config.business_name}`

  const lines: string[] = []
  if (isEscalation) {
    lines.push(`Caller needs human help immediately.`)
    if (args.reason)    lines.push(`Reason: ${args.reason}`)
    if (callerPhone)    lines.push(`Caller phone: ${callerPhone}`)
  } else {
    if (args.caller_name)  lines.push(`Name: ${args.caller_name}`)
    if (args.caller_phone || callerPhone) lines.push(`Phone: ${args.caller_phone ?? callerPhone}`)
    if (args.caller_email) lines.push(`Email: ${args.caller_email}`)
    if (args.message)      lines.push(`\nNotes: ${args.message}`)
  }
  const body = lines.join('\n')

  // 1. ntfy.sh push notification (free, instant to phone)
  if (ntfyTopic) {
    fetch(`https://ntfy.sh/${ntfyTopic}`, {
      method: 'POST',
      headers: { Title: title, Priority: isEscalation ? 'urgent' : 'default', Tags: isEscalation ? 'rotating_light' : 'bell' },
      body,
    }).then(r => r.ok ? console.log('[Relay] ntfy push sent') : console.warn('[Relay] ntfy push failed'))
      .catch(e => console.warn('[Relay] ntfy error:', e.message))
  }

  // 2. Resend email notification (free tier 3k/month)
  if (resendKey) {
    fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        from,
        to:      [ownerEmail],
        subject: title,
        text:    body,
      }),
    }).then(r => r.ok ? console.log(`[Relay] Owner email sent to ${ownerEmail}`) : console.warn('[Relay] Owner email failed'))
      .catch(e => console.warn('[Relay] Owner email error:', e.message))
  } else {
    console.warn('[Relay] Owner notification skipped — RESEND_API_KEY not set')
  }
}

// ─── Caller confirmation SMS ──────────────────────────────────────────────────

async function sendCallerConfirmationSMS(toPhone: string, callerName: string): Promise<boolean> {
  const sid  = process.env.TWILIO_ACCOUNT_SID
  const auth = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER ?? process.env.TWILIO_PHONE_NUMBER
  if (!sid || !auth || !from) { console.warn('[Relay] Caller SMS skipped — Twilio creds missing'); return false }

  const body = `Hey ${callerName}! This is WebCrew — your free website is being built tonight. You'll get the live link in your inbox by tomorrow morning. Questions? Reply here anytime. – WebCrew Team`
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method:  'POST',
      headers: {
        Authorization:  `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: from, To: toPhone, Body: body }).toString(),
    })
    if (res.ok) { console.log(`[Relay] Caller SMS sent to ${toPhone}`); return true }
    const e = await res.json() as any
    console.warn(`[Relay] Caller SMS failed: ${e?.message}`)
    return false
  } catch (e: any) {
    console.warn(`[Relay] Caller SMS error: ${e.message}`)
    return false
  }
}

// ─── Caller confirmation email ────────────────────────────────────────────────

async function sendCallerConfirmationEmail(toEmail: string, callerName: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.OUTREACH_FROM_EMAIL ?? 'hello@webcrew.app'
  if (!key) { console.warn('[Relay] Email confirmation skipped — RESEND_API_KEY missing'); return false }

  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0a0a0a;color:#fff;padding:40px 20px;">
<div style="max-width:520px;margin:0 auto;background:#111827;border-radius:12px;padding:32px 36px;border:1px solid rgba(255,255,255,0.08);">
  <p style="margin:0 0 8px;color:rgba(255,255,255,0.5);font-size:11px;letter-spacing:2px;text-transform:uppercase;">WebCrew</p>
  <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;">Your free website is being built tonight 🎉</h2>
  <p style="color:rgba(255,255,255,0.75);line-height:1.7;">Hey ${callerName},</p>
  <p style="color:rgba(255,255,255,0.75);line-height:1.7;">We're building your custom website right now — overnight. You'll wake up to a live link in your inbox by tomorrow morning.</p>
  <p style="color:rgba(255,255,255,0.75);line-height:1.7;">No card. No commitment. Just check it out and tell us what you think.</p>
  <p style="margin-top:28px;color:rgba(255,255,255,0.5);font-size:13px;">Questions? Reply to this email or text us at the number you just called.<br>— The WebCrew Team</p>
</div></body></html>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        from,
        to:      [toEmail],
        subject: "Your free website is being built tonight 🎉",
        html,
      }),
    })
    if (res.ok) { console.log(`[Relay] Confirmation email sent to ${toEmail}`); return true }
    const e = await res.json() as any
    console.warn(`[Relay] Confirmation email failed: ${e?.message}`)
    return false
  } catch (e: any) {
    console.warn(`[Relay] Confirmation email error: ${e.message}`)
    return false
  }
}
