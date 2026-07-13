/**
 * Webcrew API — Cloudflare Worker
 * Deploy: cd api && npx wrangler deploy
 * Domain: api.webcrew.app
 *
 * Routes:
 *   POST /leads          — contact form submissions from all deployed sites
 *   POST /sms/reply      — Twilio inbound SMS webhook + Gemini reply agent
 *   GET  /hitl           — HITL approval page (Pavan reviews + sends demo link)
 *   POST /hitl/send      — sends demo SMS + email to lead after approval
 *   GET  /health         — uptime check
 */

export interface Env {
  RESEND_API_KEY: string
  TWILIO_ACCOUNT_SID: string
  TWILIO_AUTH_TOKEN: string
  TWILIO_FROM_NUMBER: string
  LEADS_SHEET_ID: string
  GOOGLE_SERVICE_ACCOUNT_JSON: string
  NOTIFICATION_EMAIL: string       // pavan.harati@gmail.com
  CALENDLY_URL: string
  HITL_SECRET?: string             // shared secret for approval links (set via wrangler secret)
  NEON_DATABASE_URL?: string
  GOOGLE_AI_API_KEY?: string       // fallback only — prefer GOOGLE_SERVICE_ACCOUNT_JSON + Vertex AI
  RECEPTION_SERVER_URL?: string
  RECEPTION_PROVISION_SECRET?: string
  CAL_WEBHOOK_SECRET?: string
  GOOGLE_REVIEW_URL_TEMPLATE?: string  // e.g. "https://g.page/r/{placeId}/review"
}

// ─── Contact form lead ────────────────────────────────────────────────────

interface ContactLead {
  firstName: string
  lastName?: string
  phone?: string
  email?: string
  service?: string
  message?: string
  source: string
  businessName: string
  businessNiche: string
  businessOwnerPhone?: string   // injected by builder from lead data
  businessOwnerEmail?: string   // injected by builder from lead data
  submittedAt: string
}

// ─── Resend email ─────────────────────────────────────────────────────────

async function sendEmail(env: Env, to: string, subject: string, html: string): Promise<void> {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'leads@webcrew.app', to, subject, html }),
  })
}

// ─── Twilio SMS ───────────────────────────────────────────────────────────

async function sendSms(env: Env, to: string, body: string): Promise<void> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_FROM_NUMBER) return
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`
  const params = new URLSearchParams({ To: to, From: env.TWILIO_FROM_NUMBER, Body: body })
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
}

async function neonQuery(env: Env, query: string, params: unknown[] = []): Promise<any | null> {
  if (!env.NEON_DATABASE_URL) return null
  try {
    const res = await fetch(env.NEON_DATABASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, params }),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// Logs an inbound-SMS activity event against the matching lead's timeline.
async function logSmsEvent(
  env: Env,
  phone: string,
  eventType: 'sms_replied' | 'sms_opted_out',
  detail?: Record<string, unknown>
): Promise<void> {
  const lead = await neonQuery(
    env,
    `SELECT id FROM leads WHERE phone = $1 OR international_phone = $1 LIMIT 1`,
    [phone]
  )
  const leadId = lead?.rows?.[0]?.id
  if (!leadId) return
  await neonQuery(
    env,
    `INSERT INTO lead_events (lead_id, event_type, detail) VALUES ($1, $2, $3)`,
    [leadId, eventType, detail ? JSON.stringify(detail) : null]
  )
}

// ─── Google Sheets append ─────────────────────────────────────────────────

async function appendToSheets(env: Env, lead: ContactLead): Promise<void> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.LEADS_SHEET_ID) return
  try {
    const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON)
    // Simple JWT + Sheets append via REST — full impl in retention agent
    // Minimal version: just log, full version wired in pipeline retention.ts
    console.log(`[Sheets] Lead from ${lead.businessName}: ${lead.firstName} ${lead.phone || lead.email}`)
  } catch { /* non-blocking */ }
}

// ─── POST /leads handler ──────────────────────────────────────────────────

async function handleLeadSubmission(req: Request, env: Env): Promise<Response> {
  const lead: ContactLead = await req.json()
  const visitorName = `${lead.firstName}${lead.lastName ? ' ' + lead.lastName : ''}`
  const contact = lead.phone || lead.email || 'unknown'

  // 1. Notify us — every lead logged to our email
  await sendEmail(
    env,
    env.NOTIFICATION_EMAIL || 'hello@webcrew.app',
    `🔔 New lead: ${lead.businessName} — ${visitorName}`,
    `
    <h2>New contact form submission</h2>
    <table>
      <tr><td><b>Business:</b></td><td>${lead.businessName} (${lead.businessNiche})</td></tr>
      <tr><td><b>Visitor:</b></td><td>${visitorName}</td></tr>
      <tr><td><b>Phone:</b></td><td>${lead.phone || '—'}</td></tr>
      <tr><td><b>Email:</b></td><td>${lead.email || '—'}</td></tr>
      <tr><td><b>Service:</b></td><td>${lead.service || '—'}</td></tr>
      <tr><td><b>Message:</b></td><td>${lead.message || '—'}</td></tr>
      <tr><td><b>Source:</b></td><td>${lead.source}</td></tr>
      <tr><td><b>Time:</b></td><td>${lead.submittedAt}</td></tr>
    </table>
    `
  )

  // 2. SMS the business owner — "you just got a lead on your demo site!"
  // This is the killer hook. They see proof of value before paying.
  if (lead.businessOwnerPhone) {
    await sendSms(
      env,
      lead.businessOwnerPhone,
      `📲 ${lead.businessName}: New inquiry from ${visitorName} (${contact}) via your demo site!\n\nReply INTERESTED to claim this site — ${env.CALENDLY_URL || 'webcrew.app'}`
    )
  }

  // 3. Email the business owner (if we have their email)
  if (lead.businessOwnerEmail) {
    await sendEmail(
      env,
      lead.businessOwnerEmail,
      `You just got a new customer inquiry — ${lead.businessName}`,
      `
      <h2>Someone contacted your business through your demo website!</h2>
      <p><b>${visitorName}</b> just submitted a contact request:</p>
      <ul>
        <li>Phone: ${lead.phone || '—'}</li>
        <li>Email: ${lead.email || '—'}</li>
        <li>Looking for: ${lead.service || lead.message || '—'}</li>
      </ul>
      <p>This is what your website can do for you — 24/7, on autopilot.</p>
      <p><a href="${env.CALENDLY_URL || 'https://webcrew.app'}">Book a 15-min call to activate your site →</a></p>
      <hr>
      <p style="color:#999;font-size:12px">This demo was built by Webcrew. You're not live yet — <a href="${env.CALENDLY_URL}">get live today</a>.</p>
      `
    )
  }

  // 4. Google Sheets log
  await appendToSheets(env, lead)

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

// ─── SMS reply handler (Twilio webhook) ──────────────────────────────────────

const OPT_OUT_WORDS = ['stop', 'unsubscribe', 'quit', 'cancel', 'opt out', 'remove me']
const YES_WORDS = ['yes', 'yeah', 'yep', 'interested', 'sounds good', "let's do it", 'i want']

function isOptOut(text: string): boolean {
  const t = text.toLowerCase()
  return OPT_OUT_WORDS.some(w => t.includes(w))
}

function isYes(text: string): boolean {
  const t = text.toLowerCase().trim()
  return YES_WORDS.some(w => t.includes(w))
}

// ─── GCP Service Account → Vertex AI token (crypto.subtle RSA, CF Workers compatible) ───

async function getVertexToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson)
  const now = Math.floor(Date.now() / 1000)
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const payload = btoa(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const signingInput = `${header}.${payload}`
  const pemBody = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const jwt = `${signingInput}.${sigB64}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString(),
  })
  const tokenData: any = await tokenRes.json()
  return tokenData.access_token
}

async function geminiSMSReply(env: Env, context: string, incomingMsg: string): Promise<string> {
  const prompt = `${context}\n\nThe prospect replied: "${incomingMsg}"\n\nWrite a single SMS reply (max 160 chars). Just the reply text, no quotes or labels.`

  let authHeader: string
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const token = await getVertexToken(env.GOOGLE_SERVICE_ACCOUNT_JSON)
    authHeader = `Bearer ${token}`
  } else if (env.GOOGLE_AI_API_KEY) {
    // fallback: AI Studio key
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GOOGLE_AI_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
    )
    const json: any = await res.json()
    return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
  } else {
    return ''
  }

  // Vertex AI endpoint (GCP project gen-lang-client-0844283339)
  const res = await fetch(
    'https://us-central1-aiplatform.googleapis.com/v1/projects/gen-lang-client-0844283339/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
    }
  )
  const json: any = await res.json()
  return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
}

// ─── Async: look up lead by phone, provision Gemini Live reception ────────────

async function triggerReceptionProvision(env: Env, phone: string): Promise<void> {
  // Fetch lead by phone from Neon (direct SQL via Neon HTTP API)
  const res = await fetch(`${env.NEON_DATABASE_URL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `SELECT id, name, website FROM leads WHERE phone = $1 AND tier = 'tier2' AND website IS NOT NULL LIMIT 1`,
      params: [phone],
    }),
  })
  if (!res.ok) return

  const data: any = await res.json()
  const lead = data.rows?.[0]
  if (!lead?.website) {
    console.log(`[Provision] No tier2 lead with website found for ${phone}`)
    return
  }

  console.log(`[Provision] Triggering reception for ${lead.name}: ${lead.website}`)
  await fetch(`${env.RECEPTION_SERVER_URL}/provision`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.RECEPTION_PROVISION_SECRET ? { Authorization: `Bearer ${env.RECEPTION_PROVISION_SECRET}` } : {}),
    },
    body: JSON.stringify({ websiteUrl: lead.website, businessName: lead.name, leadId: lead.id }),
  })
}

async function handleSMSWebhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Twilio sends form-encoded body
  const body = await req.text()
  const params = new URLSearchParams(body)
  const from = params.get('From') ?? ''
  const msgBody = params.get('Body') ?? ''
  const twimlResponse = (msg: string) =>
    new Response(`<?xml version="1.0"?><Response><Message>${msg}</Message></Response>`, {
      headers: { 'Content-Type': 'text/xml' },
    })

  if (!from || !msgBody) return twimlResponse('')

  // Log every inbound reply against the lead's activity timeline (fire-and-forget)
  if (env.NEON_DATABASE_URL) {
    logSmsEvent(env, from, 'sms_replied', { body: msgBody }).catch(() => {})
  }

  // Opt-out — mandatory TCPA compliance
  if (isOptOut(msgBody)) {
    // Update DB opt-out and consent revocation (fire-and-forget)
    if (env.NEON_DATABASE_URL) {
      neonQuery(
        env,
        `UPDATE leads
         SET sms_opt_out = TRUE
         WHERE phone = $1 OR international_phone = $1`,
        [from]
      ).catch(() => {})
      neonQuery(
        env,
        `UPDATE consent_events
         SET revoked_at = NOW()
         WHERE channel = 'sms'
           AND contact = $1
           AND revoked_at IS NULL`,
        [from]
      ).catch(() => {})
      logSmsEvent(env, from, 'sms_opted_out').catch(() => {})
    }
    console.log(`[SMS] Opt-out from ${from}`)
    return twimlResponse("Got it, you've been removed from our list. Have a great day!")
  }

  // ── Business owner attendance confirmation (YES/NO for appointment) ─────────
  // Must run before sales YES handler so owner "yes" doesn't trigger HITL flow
  if (env.NEON_DATABASE_URL) {
    const ownerCheck = await neonQuery(
      env,
      `SELECT id, attendee_name, attendee_phone, business_name, review_link
       FROM cal_bookings
       WHERE business_owner_phone = $1
         AND host_confirmed IS NULL
         AND host_confirm_sent_at IS NOT NULL
         AND end_time > NOW() - INTERVAL '24 hours'
       ORDER BY end_time DESC LIMIT 1`,
      [from]
    )
    const ownerBooking = ownerCheck?.rows?.[0]
    if (ownerBooking) {
      const m = msgBody.toLowerCase().trim()
      const isOwnerYes = /^(yes|y|yeah|yep|1|showed|attended|here|came)/.test(m)
      const isOwnerNo  = /^(no|n|nope|2|didn'?t|no.?show|absent|miss)/.test(m)
      if (isOwnerYes || isOwnerNo) {
        ctx.waitUntil((async () => {
          if (isOwnerYes) {
            await neonQuery(env,
              `UPDATE cal_bookings SET host_confirmed = TRUE, host_confirmed_at = NOW()
               WHERE id = $1`, [ownerBooking.id])
            // Review SMS to customer will be sent by send-review-requests.ts hourly cron
            // But also try immediately if they have a phone
            if (ownerBooking.attendee_phone && env.TWILIO_ACCOUNT_SID) {
              const reviewUrl = ownerBooking.review_link || 'https://webcrew.app/review'
              const first = (ownerBooking.attendee_name || 'there').split(' ')[0]
              await sendSms(env, ownerBooking.attendee_phone,
                `Hi ${first}! Thanks for your appointment with ${ownerBooking.business_name}. Mind leaving a quick review? Takes 30 sec: ${reviewUrl}`)
              await neonQuery(env,
                `UPDATE cal_bookings SET review_request_sent_at = NOW() WHERE id = $1`,
                [ownerBooking.id])
            }
          } else {
            await neonQuery(env,
              `UPDATE cal_bookings SET host_confirmed = FALSE, host_confirmed_at = NOW(), status = 'no_show'
               WHERE id = $1`, [ownerBooking.id])
            if (ownerBooking.attendee_phone && env.TWILIO_ACCOUNT_SID) {
              const first = (ownerBooking.attendee_name || 'there').split(' ')[0]
              await sendSms(env, ownerBooking.attendee_phone,
                `Hi ${first}! We noticed you missed your appointment with ${ownerBooking.business_name}. Easy to rebook: ${env.CALENDLY_URL || 'webcrew.app'}`)
            }
          }
        })())
        return twimlResponse(isOwnerYes
          ? `Got it! We'll send ${(ownerBooking.attendee_name || 'them').split(' ')[0]} a review request. Thanks!`
          : `Got it — we'll reach out to help them reschedule. Thanks for letting us know!`
        )
      }
    }
  }

  // Strong YES — HITL flow: notify Pavan, send acknowledgment to lead
  if (isYes(msgBody)) {
    // Look up lead details from DB for the HITL email
    if (env.NEON_DATABASE_URL) {
      ctx.waitUntil((async () => {
        try {
          const rows = await neonQuery(
            env,
            `SELECT business_name, niche, city, email FROM leads
             WHERE phone = $1 OR international_phone = $1
             ORDER BY created_at DESC LIMIT 1`,
            [from]
          )
          const lead = rows?.[0]
          await notifyHITL(
            env,
            from,
            lead?.business_name ?? 'Unknown Business',
            lead?.niche ?? 'local business',
            lead?.city ?? '',
            lead?.email ?? ''
          )
        } catch (e: any) {
          console.error('[SMS HITL] notify error:', e.message)
          // Still notify Pavan with just the phone
          await notifyHITL(env, from, 'Unknown Business', 'local business', '', '')
        }
      })())
    }

    // Immediate acknowledgment to lead (warm them up while Pavan reviews)
    return twimlResponse("That's great to hear! We'll put the finishing touches on your site and send you a link shortly. 🚀")
  }

  // General reply — respond to Twilio instantly, send Gemini reply via REST API async
  // Avoids Twilio 15s webhook timeout on slow Vertex AI calls
  const context = `You are a friendly website sales rep for WebCrew texting a local business owner.
Be short (max 160 chars). Warm but direct.
If they show interest, offer to schedule a 15-min call via ${env.CALENDLY_URL || 'webcrew.app'}.
Never promise specific rankings. Max 3 sentences.`

  // ctx.waitUntil keeps worker alive after response — required for background async in CF Workers
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON || env.GOOGLE_AI_API_KEY) {
    ctx.waitUntil((async () => {
      try {
        const reply = await geminiSMSReply(env, context, msgBody)
        const msg = reply || `Thanks! Let's connect: ${env.CALENDLY_URL || 'webcrew.app'}`
        await sendSms(env, from, msg)
      } catch (e: any) {
        console.error('[SMS webhook] Gemini/send error:', e.message)
        await sendSms(env, from, `Thanks for your reply! Let's chat: ${env.CALENDLY_URL || 'webcrew.app'}`)
      }
    })())
  }

  // Instant empty TwiML — Twilio gets 200 immediately, no timeout risk
  return new Response('<?xml version="1.0"?><Response/>', {
    headers: { 'Content-Type': 'text/xml' },
  })
}

// ─── POST /audit handler ──────────────────────────────────────────────────

async function handleAuditRequest(req: Request, env: Env): Promise<Response> {
  const { name, email, phone, websiteUrl, source } = await req.json() as {
    name: string; email: string; phone?: string; websiteUrl: string; source?: string
  }

  if (!email || !websiteUrl) {
    return new Response(JSON.stringify({ error: 'email and websiteUrl required' }), {
      status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  // 1. Notify us immediately
  await sendEmail(
    env,
    env.NOTIFICATION_EMAIL || 'pavan.harati@gmail.com',
    `🔍 Free Audit Request: ${name} — ${websiteUrl}`,
    `<p><b>${name}</b> requested a free audit for <a href="${websiteUrl}">${websiteUrl}</a></p>
     <p>Email: ${email}</p><p>Phone: ${phone || '—'}</p><p>Source: ${source || 'webcrew.app'}</p>`
  )

  // 2. Run audit async (don't block response — use waitUntil pattern via background promise)
  runAuditAndEmail(env, { name, email, phone, websiteUrl }).catch(e =>
    console.error('[Audit] Failed:', e.message)
  )

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

async function runAuditAndEmail(env: Env, opts: {
  name: string; email: string; phone?: string; websiteUrl: string
}): Promise<void> {
  const { name, email, websiteUrl } = opts

  // 1. PageSpeed (mobile) — free, no key needed for basic quota
  let speedScore = 0; let lcp = '—'; let cls = '—'; let fid = '—'
  try {
    const psUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(websiteUrl)}&strategy=mobile`
    const ps = await fetch(psUrl)
    if (ps.ok) {
      const psData: any = await ps.json()
      speedScore = Math.round((psData.lighthouseResult?.categories?.performance?.score ?? 0) * 100)
      lcp = psData.lighthouseResult?.audits?.['largest-contentful-paint']?.displayValue ?? '—'
      cls = psData.lighthouseResult?.audits?.['cumulative-layout-shift']?.displayValue ?? '—'
      fid = psData.lighthouseResult?.audits?.['total-blocking-time']?.displayValue ?? '—'
    }
  } catch { /* non-blocking */ }

  // 2. Fetch homepage HTML for basic SEO checks
  let hasTitle = false; let hasMeta = false; let hasH1 = false
  let hasSchema = false; let isHttps = websiteUrl.startsWith('https')
  let htmlSnippet = ''
  try {
    const pageRes = await fetch(websiteUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WebCrewBot/1.0)' } })
    const html = await pageRes.text()
    htmlSnippet = html.slice(0, 6000)
    hasTitle  = /<title[^>]*>[^<]+<\/title>/i.test(html)
    hasMeta   = /meta[^>]+name=["']description["'][^>]+content=["'][^"']{10,}/i.test(html)
    hasH1     = /<h1[^>]*>[^<]+<\/h1>/i.test(html)
    hasSchema = html.includes('application/ld+json')
  } catch { /* non-blocking */ }

  // 3. Gemini audit summary
  let auditSummary = ''; let grade = 'C'; let topFixes: string[] = []
  if (env.GOOGLE_AI_API_KEY) {
    try {
      const prompt = `You are a professional website auditor. Analyze this website: ${websiteUrl}

PageSpeed mobile score: ${speedScore}/100
LCP: ${lcp} | CLS: ${cls} | TBT: ${fid}
Has title tag: ${hasTitle} | Has meta description: ${hasMeta} | Has H1: ${hasH1}
Has schema markup: ${hasSchema} | HTTPS: ${isHttps}

Homepage HTML snippet:
${htmlSnippet}

Write a concise audit report in JSON format:
{
  "grade": "A/B/C/D/F",
  "overall_score": 0-100,
  "headline": "one punchy sentence about the site",
  "summary": "2-3 sentences on the biggest issues",
  "top_3_fixes": ["fix 1", "fix 2", "fix 3"],
  "wins": ["what they do well 1", "what they do well 2"]
}

Be honest and specific. If score < 50, be direct about the problems.`

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GOOGLE_AI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
      )
      const json: any = await res.json()
      const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        grade = parsed.grade ?? 'C'
        auditSummary = parsed.summary ?? ''
        topFixes = parsed.top_3_fixes ?? []
      }
    } catch { /* non-blocking */ }
  }

  const gradeColor = grade === 'A' ? '#16a34a' : grade === 'B' ? '#2563eb' : grade === 'C' ? '#d97706' : '#dc2626'
  const scoreColor = speedScore >= 80 ? '#16a34a' : speedScore >= 50 ? '#d97706' : '#dc2626'

  // 4. Send HTML email with audit results
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px">

    <!-- Header -->
    <div style="background:#111827;border-radius:16px;padding:32px;margin-bottom:24px;text-align:center">
      <div style="font-family:'Space Grotesk',sans-serif;font-weight:800;font-size:1.4rem;color:#B5880E;margin-bottom:8px">WebCrew</div>
      <h1 style="color:#fff;font-size:1.6rem;font-weight:800;margin:0 0 8px;letter-spacing:-0.02em">Your FREE Website Audit</h1>
      <p style="color:rgba(255,255,255,0.6);margin:0;font-size:0.9rem">${websiteUrl}</p>
    </div>

    <!-- Grade card -->
    <div style="background:#fff;border-radius:16px;padding:28px;margin-bottom:20px;border:1px solid rgba(0,0,0,0.08);box-shadow:0 2px 20px rgba(0,0,0,0.06)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div>
          <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#6b7280;margin-bottom:4px">OVERALL GRADE</div>
          <div style="font-size:3.5rem;font-weight:800;color:${gradeColor};line-height:1">${grade}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#6b7280;margin-bottom:4px">PAGESPEED (MOBILE)</div>
          <div style="font-size:3rem;font-weight:800;color:${scoreColor};line-height:1">${speedScore}<span style="font-size:1rem;color:#6b7280">/100</span></div>
        </div>
      </div>
      ${auditSummary ? `<p style="color:#374151;font-size:0.95rem;line-height:1.7;margin:0;padding:16px;background:#f9fafb;border-radius:8px;border-left:3px solid ${gradeColor}">${auditSummary}</p>` : ''}
    </div>

    <!-- Core vitals -->
    <div style="background:#fff;border-radius:16px;padding:24px;margin-bottom:20px;border:1px solid rgba(0,0,0,0.08)">
      <div style="font-size:0.75rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#6b7280;margin-bottom:16px">Core Web Vitals</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        ${[
          { label: 'LCP', val: lcp, tip: 'Largest Contentful Paint' },
          { label: 'CLS', val: cls, tip: 'Cumulative Layout Shift' },
          { label: 'TBT', val: fid, tip: 'Total Blocking Time' },
        ].map(v => `
          <div style="background:#f9fafb;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:0.6rem;color:#9ca3af;margin-bottom:4px">${v.tip}</div>
            <div style="font-size:1rem;font-weight:700;color:#111827">${v.val}</div>
            <div style="font-size:0.65rem;color:#6b7280;font-weight:700">${v.label}</div>
          </div>`).join('')}
      </div>
    </div>

    <!-- SEO checks -->
    <div style="background:#fff;border-radius:16px;padding:24px;margin-bottom:20px;border:1px solid rgba(0,0,0,0.08)">
      <div style="font-size:0.75rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#6b7280;margin-bottom:16px">SEO Checklist</div>
      ${[
        { label: 'Title Tag', ok: hasTitle },
        { label: 'Meta Description', ok: hasMeta },
        { label: 'H1 Heading', ok: hasH1 },
        { label: 'Schema Markup', ok: hasSchema },
        { label: 'HTTPS Secure', ok: isHttps },
      ].map(c => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6">
          <div style="width:20px;height:20px;border-radius:50%;background:${c.ok ? '#dcfce7' : '#fee2e2'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px">
            ${c.ok ? '✓' : '✗'}
          </div>
          <div style="font-size:0.88rem;color:${c.ok ? '#16a34a' : '#dc2626'};font-weight:${c.ok ? '500' : '600'}">${c.label} — ${c.ok ? 'Good' : 'Missing'}</div>
        </div>`).join('')}
    </div>

    ${topFixes.length ? `
    <!-- Top 3 fixes -->
    <div style="background:#fff;border-radius:16px;padding:24px;margin-bottom:20px;border:1px solid rgba(0,0,0,0.08)">
      <div style="font-size:0.75rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#6b7280;margin-bottom:16px">Top 3 Quick Wins</div>
      ${topFixes.map((fix, i) => `
        <div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #f3f4f6">
          <div style="width:24px;height:24px;border-radius:6px;background:#B5880E;color:#fff;font-weight:700;font-size:0.75rem;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
          <div style="font-size:0.88rem;color:#374151;line-height:1.5">${fix}</div>
        </div>`).join('')}
    </div>` : ''}

    <!-- CTA -->
    <div style="background:linear-gradient(135deg,#111827,#1f2937);border-radius:16px;padding:32px;text-align:center">
      <h2 style="color:#fff;font-size:1.3rem;font-weight:800;margin:0 0 12px;letter-spacing:-0.02em">Want us to fix all of this — FREE?</h2>
      <p style="color:rgba(255,255,255,0.7);font-size:0.9rem;margin:0 0 24px;line-height:1.6">We'll build you a completely new, high-performance website. You only pay if you love it.</p>
      <a href="https://webcrew.app/#contact" style="display:inline-block;background:#B5880E;color:#fff;font-weight:700;padding:14px 32px;border-radius:100px;text-decoration:none;font-size:0.95rem">
        Get My FREE Demo Site →
      </a>
    </div>

    <p style="text-align:center;color:#9ca3af;font-size:0.75rem;margin-top:24px">
      WebCrew · <a href="https://webcrew.app/privacy" style="color:#9ca3af">Privacy Policy</a> · <a href="https://webcrew.app/terms" style="color:#9ca3af">Terms</a>
    </p>
  </div>
</body>
</html>`

  await sendEmail(env, email, `Your FREE Website Audit — ${websiteUrl.replace(/https?:\/\//, '')}`, html)
  console.log(`[Audit] Report sent to ${email} for ${websiteUrl}`)
}

// ─── Survey handler ───────────────────────────────────────────────────────

async function appendSurveyToSheets(env: Env, row: string[]): Promise<void> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.LEADS_SHEET_ID) return
  try {
    const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON)
    // JWT auth for Sheets (same pattern as retention agent)
    const now = Math.floor(Date.now() / 1000)
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const payload = btoa(JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }))
    // Note: full JWT signing not available in CF Workers without crypto.subtle RSA
    // Sheets write handled by pipeline retention agent; here we log only
    console.log(`[Survey] Sheets write queued: ${row.join(' | ')}`)
  } catch { /* non-blocking */ }
}

async function writeSurveyToNeon(env: Env, data: Record<string, string>): Promise<void> {
  if (!env.NEON_DATABASE_URL) return
  try {
    await fetch(env.NEON_DATABASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `INSERT INTO survey_responses (name, biz, phone, niche, pain, has_website, ai_want, budget)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        params: [
          data.name || null, data.biz || null, data.phone || null,
          data.niche || null,
          Array.isArray(data.pain) ? (data.pain as unknown as string[]).join(', ') : (data.pain || null),
          data.has_website || null, data.ai_want || null, data.budget || null,
        ],
      }),
    })
  } catch (e: any) {
    console.error('[Survey] Neon write failed:', e.message)
  }
}

async function handleSurveySubmission(req: Request, env: Env): Promise<Response> {
  const data = await req.json() as Record<string, string>
  const { name, biz, phone, niche, pain, has_website, ai_want, budget } = data
  const painStr = Array.isArray(pain) ? (pain as unknown as string[]).join(', ') : (pain || '—')
  const dateStr = new Date().toISOString().split('T')[0]

  // 1. Email notification (instant)
  await sendEmail(
    env,
    env.NOTIFICATION_EMAIL || 'pavan.harati@gmail.com',
    `📋 Survey: ${name || '?'} — ${biz || 'Unknown'}`,
    `<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;">
      <tr><td style="padding:6px 12px;color:#666"><b>Date</b></td><td style="padding:6px 12px">${dateStr}</td></tr>
      <tr><td style="padding:6px 12px;color:#666"><b>Name</b></td><td style="padding:6px 12px">${name || '—'}</td></tr>
      <tr><td style="padding:6px 12px;color:#666"><b>Business</b></td><td style="padding:6px 12px">${biz || '—'}</td></tr>
      <tr><td style="padding:6px 12px;color:#666"><b>Phone</b></td><td style="padding:6px 12px">${phone || '—'}</td></tr>
      <tr><td style="padding:6px 12px;color:#666"><b>Niche</b></td><td style="padding:6px 12px">${niche || '—'}</td></tr>
      <tr><td style="padding:6px 12px;color:#666"><b>Pain point</b></td><td style="padding:6px 12px">${painStr}</td></tr>
      <tr><td style="padding:6px 12px;color:#666"><b>Has website</b></td><td style="padding:6px 12px">${has_website || '—'}</td></tr>
      <tr><td style="padding:6px 12px;color:#666"><b>AI want</b></td><td style="padding:6px 12px">${ai_want || '—'}</td></tr>
      <tr><td style="padding:6px 12px;color:#666"><b>Budget</b></td><td style="padding:6px 12px">${budget || '—'}</td></tr>
    </table>`
  )

  // 2. Neon DB (persistent, queryable)
  await writeSurveyToNeon(env, data)

  // 3. Google Sheets (async log)
  appendSurveyToSheets(env, [dateStr, name||'', biz||'', phone||'', niche||'', painStr, has_website||'', ai_want||'', budget||'']).catch(() => {})

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

// ─── HITL: approval page + send demo ─────────────────────────────────────

function hitlToken(secret: string, phone: string): string {
  // Simple token: first 16 chars of base64(secret+phone) — good enough for internal tool
  return btoa(`${secret}:${phone}`).slice(0, 24).replace(/[+/=]/g, 'x')
}

function handleHITLPage(url: URL, env: Env): Response {
  const phone   = url.searchParams.get('phone') ?? ''
  const name    = url.searchParams.get('name') ?? 'Business'
  const niche   = url.searchParams.get('niche') ?? ''
  const city    = url.searchParams.get('city') ?? ''
  const email   = url.searchParams.get('email') ?? ''
  const token   = url.searchParams.get('token') ?? ''
  const secret  = env.HITL_SECRET ?? 'webcrew-hitl-2024'

  if (!phone || token !== hitlToken(secret, phone)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const sendUrl = `/hitl/send?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&niche=${encodeURIComponent(niche)}&city=${encodeURIComponent(city)}&email=${encodeURIComponent(email)}&token=${token}`

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>WebCrew HITL — Send Demo</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 16px; padding: 32px; max-width: 480px; width: 100%; }
    h1 { font-size: 1.4rem; font-weight: 800; margin-bottom: 4px; }
    .sub { color: #888; font-size: 0.85rem; margin-bottom: 24px; }
    .lead-box { background: #111; border: 1px solid #2a2a2a; border-radius: 10px; padding: 16px; margin-bottom: 24px; }
    .lead-row { display: flex; gap: 8px; margin-bottom: 6px; font-size: 0.88rem; }
    .lead-label { color: #666; min-width: 60px; }
    label { display: block; font-size: 0.8rem; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
    input { width: 100%; background: #111; border: 1px solid #333; border-radius: 8px; padding: 12px 14px; color: #fff; font-size: 0.95rem; outline: none; margin-bottom: 20px; }
    input:focus { border-color: #7c3aed; }
    button { width: 100%; background: #7c3aed; color: #fff; font-weight: 700; font-size: 1rem; padding: 14px; border: none; border-radius: 10px; cursor: pointer; }
    button:hover { background: #6d28d9; }
    .warn { color: #f59e0b; font-size: 0.8rem; margin-top: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🚀 Send Demo to Lead</h1>
    <p class="sub">Paste the Cloudflare Pages URL below and hit send.</p>

    <div class="lead-box">
      <div class="lead-row"><span class="lead-label">Name</span><span>${name}</span></div>
      <div class="lead-row"><span class="lead-label">Niche</span><span>${niche}</span></div>
      <div class="lead-row"><span class="lead-label">City</span><span>${city}</span></div>
      <div class="lead-row"><span class="lead-label">Phone</span><span>${phone}</span></div>
      ${email ? `<div class="lead-row"><span class="lead-label">Email</span><span>${email}</span></div>` : ''}
    </div>

    <form method="POST" action="${sendUrl}">
      <label>Demo URL (Cloudflare Pages)</label>
      <input type="url" name="demoUrl" placeholder="https://their-business.pages.dev" required autofocus>
      <button type="submit">✅ Approve &amp; Send Demo</button>
    </form>
    <p class="warn">⚠ This sends an SMS${email ? ' + email' : ''} to the lead immediately.</p>
  </div>
</body>
</html>`

  return new Response(html, { headers: { 'Content-Type': 'text/html' } })
}

async function handleHITLSend(req: Request, url: URL, env: Env): Promise<Response> {
  const phone  = url.searchParams.get('phone') ?? ''
  const name   = url.searchParams.get('name') ?? 'there'
  const niche  = url.searchParams.get('niche') ?? 'local business'
  const city   = url.searchParams.get('city') ?? 'your area'
  const email  = url.searchParams.get('email') ?? ''
  const token  = url.searchParams.get('token') ?? ''
  const secret = env.HITL_SECRET ?? 'webcrew-hitl-2024'

  if (!phone || token !== hitlToken(secret, phone)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const formData = await req.formData()
  const demoUrl = formData.get('demoUrl')?.toString() ?? ''
  if (!demoUrl) return new Response('Missing demoUrl', { status: 400 })

  const label = name.length > 20 ? name.slice(0, 18) + '…' : name

  // SMS to lead
  const smsBody = `Hi ${label}! Your free ${niche} website is live → ${demoUrl}\n\nLove it? Keep it for $299 one-time. Reply STOP to opt out. -WebCrew`
  await sendSms(env, phone, smsBody)

  // Email to lead (if available)
  if (email && env.RESEND_API_KEY) {
    await sendEmail(env, email, `Your free ${niche} demo site is live! 🚀`,
      `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,sans-serif">
      <div style="max-width:560px;margin:0 auto;padding:40px 20px">
        <div style="background:#111827;border-radius:16px;padding:32px;text-align:center;margin-bottom:24px">
          <div style="font-weight:800;font-size:1.2rem;color:#B5880E;margin-bottom:8px">WebCrew</div>
          <h1 style="color:#fff;font-size:1.5rem;font-weight:800;margin:0 0 8px">Your Free Demo Site is Live! 🎉</h1>
          <p style="color:rgba(255,255,255,0.6);margin:0;font-size:0.9rem">${niche} · ${city}</p>
        </div>
        <div style="background:#fff;border-radius:16px;padding:28px;border:1px solid rgba(0,0,0,0.08);text-align:center">
          <p style="color:#374151;font-size:1rem;margin:0 0 24px;line-height:1.6">Hi ${name}! We built your <b>${niche}</b> business in <b>${city}</b> a complete demo website — for free. See it below:</p>
          <a href="${demoUrl}" style="display:inline-block;background:#7c3aed;color:#fff;font-weight:700;padding:14px 32px;border-radius:100px;text-decoration:none;font-size:1rem;margin-bottom:20px">View Your Demo Site →</a>
          <p style="color:#6b7280;font-size:0.85rem;margin:0">Love it? Keep it forever for just <b>$299 one-time</b>.<br>We also offer 24/7 AI call answering for $49/mo.</p>
        </div>
        <p style="text-align:center;color:#9ca3af;font-size:0.75rem;margin-top:20px">
          WebCrew · <a href="https://webcrew.app/privacy" style="color:#9ca3af">Privacy</a> · Reply STOP to opt out of SMS
        </p>
      </div></body></html>`
    )
  }

  // Confirm to Pavan
  await sendEmail(env, env.NOTIFICATION_EMAIL,
    `✅ Demo sent: ${name} (${niche}, ${city})`,
    `<p>Demo sent to <b>${name}</b> (${phone}${email ? ' / ' + email : ''}) for <b>${niche}</b> in <b>${city}</b>.</p><p>Demo URL: <a href="${demoUrl}">${demoUrl}</a></p>`
  )

  return new Response(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0f0f0f;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
    <div style="text-align:center;padding:40px">
      <div style="font-size:3rem;margin-bottom:16px">✅</div>
      <h2 style="margin:0 0 8px">Demo sent to ${name}!</h2>
      <p style="color:#888;margin:0">SMS${email ? ' + email' : ''} delivered. Good luck 🚀</p>
    </div>
  </body></html>`, { headers: { 'Content-Type': 'text/html' } })
}

// ─── Send HITL notification to Pavan when lead says YES ──────────────────

async function notifyHITL(env: Env, phone: string, name: string, niche: string, city: string, email: string): Promise<void> {
  const secret = env.HITL_SECRET ?? 'webcrew-hitl-2024'
  const token  = hitlToken(secret, phone)
  const approveUrl = `https://api.webcrew.app/hitl?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&niche=${encodeURIComponent(niche)}&city=${encodeURIComponent(city)}&email=${encodeURIComponent(email)}&token=${token}`

  await sendEmail(env, env.NOTIFICATION_EMAIL,
    `⚡ YES received — Build needed: ${name} (${niche}, ${city})`,
    `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <h2 style="color:#7c3aed">⚡ New YES — Action Required</h2>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 0;color:#666;width:80px"><b>Name</b></td><td>${name}</td></tr>
        <tr><td style="padding:6px 0;color:#666"><b>Niche</b></td><td>${niche}</td></tr>
        <tr><td style="padding:6px 0;color:#666"><b>City</b></td><td>${city}</td></tr>
        <tr><td style="padding:6px 0;color:#666"><b>Phone</b></td><td>${phone}</td></tr>
        ${email ? `<tr><td style="padding:6px 0;color:#666"><b>Email</b></td><td>${email}</td></tr>` : ''}
      </table>
      <p style="background:#f3f4f6;padding:12px;border-radius:8px;font-family:monospace;font-size:0.85rem">
        cd /Users/pavanharati/Documents/WebsiteDeveloper/pipeline<br>
        LEAD_PHONE=${phone} npm run pipeline
      </p>
      <p style="margin-top:20px">Once built, approve &amp; send the demo:</p>
      <a href="${approveUrl}" style="display:inline-block;background:#7c3aed;color:#fff;font-weight:700;padding:14px 28px;border-radius:10px;text-decoration:none;font-size:1rem;margin-top:8px">
        🚀 Approve &amp; Send Demo
      </a>
      <p style="color:#999;font-size:0.75rem;margin-top:16px">Link expires never. Token: ${token}</p>
    </div>`
  )
}

// ─── POST /call-status — Twilio missed-call recovery ─────────────────────────
// Set this as statusCallback on the client's Twilio number in reception/server.ts
// Twilio fires when CallStatus = no-answer | busy | failed

async function handleCallStatus(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await req.text()
  const p = new URLSearchParams(body)
  const callStatus = p.get('CallStatus') ?? ''
  const caller     = p.get('From') ?? ''
  const to         = p.get('To') ?? ''
  const callSid    = p.get('CallSid') ?? ''
  const url        = new URL(req.url)
  const configId   = url.searchParams.get('configId') ?? ''
  const businessName = decodeURIComponent(url.searchParams.get('biz') ?? 'us')

  // Only recover no-answer / busy / failed calls
  if (!['no-answer', 'busy', 'failed'].includes(callStatus) || !caller) {
    return new Response('ok', { status: 200 })
  }

  console.log(`[MissedCall] ${callStatus} from ${caller} → ${businessName} (${configId})`)

  ctx.waitUntil((async () => {
    if (!env.NEON_DATABASE_URL) return

    // Check opt-out before sending any SMS
    const optOutCheck = await neonQuery(
      env,
      `SELECT sms_opt_out FROM leads WHERE phone = $1 OR international_phone = $1 LIMIT 1`,
      [caller]
    )
    if (optOutCheck?.rows?.[0]?.sms_opt_out) {
      console.log(`[MissedCall] ${caller} opted out — skip SMS`)
      return
    }

    // Log to missed_calls table
    await neonQuery(
      env,
      `INSERT INTO missed_calls (config_id, caller, business_name, call_sid, call_status, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT DO NOTHING`,
      [configId || null, caller, businessName, callSid || null, callStatus]
    )

    // Update last_missed_call_at on lead (if matched)
    await neonQuery(
      env,
      `UPDATE leads SET last_missed_call_at = NOW()
       WHERE phone = $1 OR international_phone = $1`,
      [caller]
    )

    // Send recovery SMS
    const smsBody = `Hi! You just called ${businessName} but we missed you. How can we help? Reply here or call us back at ${to}. We'll get back to you ASAP!`
    await sendSms(env, caller, smsBody)

    // Mark SMS sent in missed_calls
    await neonQuery(
      env,
      `UPDATE missed_calls SET sms_sent = TRUE, sms_sent_at = NOW()
       WHERE call_sid = $1`,
      [callSid]
    )

    // Update lead record too
    await neonQuery(
      env,
      `UPDATE leads SET missed_call_sms_sent_at = NOW()
       WHERE phone = $1 OR international_phone = $1`,
      [caller]
    )

    console.log(`[MissedCall] Recovery SMS sent to ${caller}`)
  })())

  return new Response('ok', { status: 200 })
}

// ─── POST /cal-webhook — Cal.com booking lifecycle webhook ───────────────────
// Configure in Cal.com → Settings → Developer → Webhooks → add URL:
//   https://api.webcrew.app/cal-webhook
// Subscribe to ALL events:
//   BOOKING_CREATED, BOOKING_CANCELLED, BOOKING_RESCHEDULED, BOOKING_NO_SHOW

async function handleCalWebhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const payload: any = await req.json()
  const trigger = (payload.triggerEvent ?? payload.trigger ?? '').toUpperCase()
  const booking = payload.payload ?? payload

  const HANDLED = ['BOOKING_CREATED','BOOKING_CONFIRMED','BOOKING_CANCELLED',
                   'BOOKING_RESCHEDULED','BOOKING_REJECTED','BOOKING_NO_SHOW',
                   'MEETING_ENDED']
  if (!HANDLED.includes(trigger)) {
    return new Response('ignored', { status: 200 })
  }

  const uid           = booking.uid ?? booking.bookingId ?? ''
  const startTime     = booking.startTime ?? ''
  const endTime       = booking.endTime ?? ''
  const attendee      = booking.attendees?.[0] ?? {}
  const atName        = attendee.name ?? ''
  const atEmail       = attendee.email ?? ''
  const atPhone       = booking.metadata?.phone ?? attendee.phone ?? ''
  const eventTypeId   = String(booking.eventTypeId ?? '')
  const hostName      = booking.organizer?.name ?? booking.user?.name ?? ''
  const businessName  = booking.metadata?.businessName ?? hostName
  const rescheduleUid = booking.rescheduleUid ?? null  // new uid after reschedule
  const organizerEmail = booking.organizer?.email ?? booking.user?.email ?? ''
  const organizerPhone = booking.organizer?.phone ?? ''

  if (!uid) return new Response('missing uid', { status: 400 })

  ctx.waitUntil((async () => {
    if (!env.NEON_DATABASE_URL) return

    // Resolve business owner phone — try Cal.com payload first, then leads table by organizer email
    let businessOwnerPhone: string | null = organizerPhone || null
    if (!businessOwnerPhone && organizerEmail) {
      const bizMatch = await neonQuery(
        env,
        `SELECT COALESCE(international_phone, phone) AS phone FROM leads
         WHERE email = $1 OR business_email = $1 LIMIT 1`,
        [organizerEmail]
      )
      businessOwnerPhone = bizMatch?.rows?.[0]?.phone || null
    }

    // Match to lead by email or phone (attendee — for analytics linkage)
    let leadId: string | null = null
    if (atEmail || atPhone) {
      const match = await neonQuery(
        env,
        `SELECT id FROM leads WHERE email = $1 OR phone = $2 OR international_phone = $2 LIMIT 1`,
        [atEmail || null, atPhone || null]
      )
      leadId = match?.rows?.[0]?.id ?? null
    }

    // ── BOOKING_CREATED / BOOKING_CONFIRMED ──────────────────────────────────
    if (['BOOKING_CREATED','BOOKING_CONFIRMED'].includes(trigger)) {
      if (!startTime) return

      await neonQuery(
        env,
        `INSERT INTO cal_bookings
           (booking_uid, lead_id, attendee_name, attendee_email, attendee_phone,
            business_name, event_type_id, start_time, end_time, status, business_owner_phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10)
         ON CONFLICT (booking_uid) DO UPDATE SET
           status = 'confirmed',
           attendee_phone = COALESCE(EXCLUDED.attendee_phone, cal_bookings.attendee_phone),
           business_owner_phone = COALESCE(EXCLUDED.business_owner_phone, cal_bookings.business_owner_phone),
           start_time = EXCLUDED.start_time,
           end_time   = EXCLUDED.end_time`,
        [uid, leadId, atName||null, atEmail||null, atPhone||null,
         businessName||null, eventTypeId||null, startTime, endTime, businessOwnerPhone||null]
      )
      console.log(`[Cal] CONFIRMED ${uid} → ${atName} at ${startTime}`)

      // Confirmation SMS to attendee
      if (atPhone && env.TWILIO_ACCOUNT_SID) {
        const dtStr = new Date(startTime).toLocaleString('en-US',
          { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit',
            timeZone: 'America/Los_Angeles' })
        await sendSms(env, atPhone,
          `Your appointment with ${businessName} is confirmed for ${dtStr}. Reply CANCEL to cancel.`)
      }

      if (env.NOTIFICATION_EMAIL) {
        await sendEmail(env, env.NOTIFICATION_EMAIL,
          `📅 Booking: ${atName} → ${businessName}`,
          `<p><b>${atName}</b> booked with <b>${businessName}</b> for ${startTime}</p>
           <p>Phone: ${atPhone||'—'} | Email: ${atEmail||'—'}</p>`)
      }
    }

    // ── BOOKING_RESCHEDULED ───────────────────────────────────────────────────
    else if (trigger === 'BOOKING_RESCHEDULED') {
      // Mark old booking rescheduled, upsert new booking uid
      await neonQuery(
        env,
        `UPDATE cal_bookings SET status = 'rescheduled' WHERE booking_uid = $1`,
        [uid]
      )
      if (rescheduleUid && startTime) {
        await neonQuery(
          env,
          `INSERT INTO cal_bookings
             (booking_uid, lead_id, attendee_name, attendee_email, attendee_phone,
              business_name, event_type_id, start_time, end_time, status, business_owner_phone)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10)
           ON CONFLICT (booking_uid) DO UPDATE SET
             status = 'confirmed',
             business_owner_phone = COALESCE(EXCLUDED.business_owner_phone, cal_bookings.business_owner_phone),
             start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
          [rescheduleUid, leadId, atName||null, atEmail||null, atPhone||null,
           businessName||null, eventTypeId||null, startTime, endTime, businessOwnerPhone||null]
        )
      }
      console.log(`[Cal] RESCHEDULED ${uid} → ${rescheduleUid} at ${startTime}`)

      // Reschedule confirmation SMS
      if (atPhone && env.TWILIO_ACCOUNT_SID && startTime) {
        const dtStr = new Date(startTime).toLocaleString('en-US',
          { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit',
            timeZone: 'America/Los_Angeles' })
        await sendSms(env, atPhone,
          `Your appointment with ${businessName} has been rescheduled to ${dtStr}. See you then!`)
      }
    }

    // ── BOOKING_CANCELLED / BOOKING_REJECTED ─────────────────────────────────
    else if (['BOOKING_CANCELLED','BOOKING_REJECTED'].includes(trigger)) {
      await neonQuery(
        env,
        `UPDATE cal_bookings SET status = 'cancelled' WHERE booking_uid = $1`,
        [uid]
      )
      console.log(`[Cal] CANCELLED ${uid} (${atName})`)

      // Rebook SMS — send 24h later via send-review-requests pattern
      // For now, send immediately with a soft rebook nudge
      if (atPhone && env.TWILIO_ACCOUNT_SID) {
        const bookUrl = env.CALENDLY_URL || 'webcrew.app'
        await sendSms(env, atPhone,
          `Your appointment with ${businessName} was cancelled. Want to rebook? Pick a new time here: ${bookUrl}`)
      }
    }

    // ── BOOKING_NO_SHOW ───────────────────────────────────────────────────────
    else if (trigger === 'BOOKING_NO_SHOW') {
      await neonQuery(
        env,
        `UPDATE cal_bookings SET status = 'no_show' WHERE booking_uid = $1`,
        [uid]
      )
      console.log(`[Cal] NO_SHOW ${uid} (${atName})`)

      // Re-engagement SMS
      if (atPhone && env.TWILIO_ACCOUNT_SID) {
        const bookUrl = env.CALENDLY_URL || 'webcrew.app'
        await sendSms(env, atPhone,
          `Hi ${atName.split(' ')[0]}! We missed you at your ${businessName} appointment. Easy to rebook here: ${bookUrl}`)
      }
    }

    // ── MEETING_ENDED — review request is handled by send-review-requests.ts ─
    else if (trigger === 'MEETING_ENDED') {
      await neonQuery(
        env,
        `UPDATE cal_bookings SET status = 'completed' WHERE booking_uid = $1`,
        [uid]
      )
      console.log(`[Cal] MEETING_ENDED ${uid}`)
    }
  })())

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// ─── Main worker ──────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    const method = req.method

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    if (url.pathname === '/leads' && method === 'POST') {
      return handleLeadSubmission(req, env)
    }

    if (url.pathname === '/audit' && method === 'POST') {
      return handleAuditRequest(req, env)
    }

    // Survey submissions from webcrew.app/survey
    if (url.pathname === '/survey' && method === 'POST') {
      return handleSurveySubmission(req, env)
    }

    // Twilio inbound SMS webhook
    if (url.pathname === '/sms/reply' && method === 'POST') {
      return handleSMSWebhook(req, env, ctx)
    }

    // HITL approval flow
    if (url.pathname === '/hitl' && method === 'GET') {
      return handleHITLPage(url, env)
    }
    if (url.pathname === '/hitl/send' && method === 'POST') {
      return handleHITLSend(req, url, env)
    }

    // Twilio call-status webhook (missed call recovery)
    if (url.pathname === '/call-status' && method === 'POST') {
      return handleCallStatus(req, env, ctx)
    }

    // Cal.com booking webhook
    if (url.pathname === '/cal-webhook' && method === 'POST') {
      return handleCalWebhook(req, env, ctx)
    }

    if (url.pathname === '/health' && method === 'GET') {
      return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not found', { status: 404 })
  },
}
