export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getDb, createMagicToken } from '@/lib/db'
import { hmacSha256Hex } from '@/lib/edge-crypto'

export const dynamic = 'force-dynamic'

// ─── Stripe signature verification ────────────────────────────────────────────

async function verifySignature(rawBody: string, sig: string, secret: string): Promise<boolean> {
  const parts = sig.split(',').reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split('=')
    if (k && v) acc[k] = v
    return acc
  }, {})
  const { t: timestamp, v1: sigHash } = parts
  if (!timestamp || !sigHash) return false
  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`)
  return expected === sigHash
}

// ─── Cloudflare Pages domain attachment ──────────────────────────────────────

async function attachDomain(projectName: string, domain: string): Promise<void> {
  const token     = process.env.CLOUDFLARE_TOKEN
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  if (!token || !accountId || !projectName || !domain) return

  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/domains`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: domain }),
    }
  ).catch(() => {})
}

// ─── AI Reception provisioning ───────────────────────────────────────────────

async function provisionReception(leadId: string, websiteUrl: string): Promise<string | null> {
  const baseUrl = process.env.RECEPTION_BASE_URL
  const secret  = process.env.RECEPTION_PROVISION_SECRET
  if (!baseUrl || !secret) return null

  try {
    const res = await fetch(`${baseUrl}/provision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId, websiteUrl }),
    })
    const data = await res.json() as any
    return data?.phone ?? null
  } catch {
    return null
  }
}

// ─── Welcome email ────────────────────────────────────────────────────────────

async function sendWelcomeEmail(params: {
  to: string
  businessName: string
  siteUrl: string
  portalUrl: string
  connectGoogleUrl: string
  receptionPhone?: string | null
  calendlyUrl?: string | null
}): Promise<void> {
  const { to, businessName, siteUrl, portalUrl, connectGoogleUrl, receptionPhone, calendlyUrl } = params
  const fromEmail = process.env.OUTREACH_FROM_EMAIL || 'hello@webcrew.app'
  const key = process.env.RESEND_API_KEY
  if (!key) return

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your site is live — ${businessName}</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
<tr><td align="center" style="padding:40px 20px 0;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

<tr><td style="background:linear-gradient(135deg,#052e16 0%,#14532d 100%);border-radius:16px 16px 0 0;padding:36px 40px 28px;border:1px solid rgba(255,255,255,0.08);border-bottom:none;">
  <p style="margin:0 0 8px;color:rgba(255,255,255,0.5);font-size:11px;letter-spacing:3px;text-transform:uppercase;">✅ Payment confirmed</p>
  <h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;letter-spacing:-0.5px;">${businessName} is live.</h1>
  <p style="margin:8px 0 0;color:rgba(255,255,255,0.45);font-size:14px;">Your professional website is up and running.</p>
</td></tr>

<tr><td style="background:#111827;border:1px solid rgba(255,255,255,0.08);border-top:none;padding:32px 40px;">
  <p style="margin:0 0 20px;color:rgba(255,255,255,0.7);font-size:16px;line-height:1.6;">
    Welcome aboard! Your site is live. Share it everywhere — Google, Instagram, business cards, everything.
  </p>
  <table cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
    <tr><td style="background:linear-gradient(135deg,#16a34a,#15803d);border-radius:12px;">
      <a href="${siteUrl}" style="display:block;padding:18px 40px;color:#fff;text-decoration:none;font-size:17px;font-weight:700;text-align:center;">🌐 &nbsp;View Your Live Site</a>
    </td></tr>
  </table>
  <p style="margin:0;color:rgba(255,255,255,0.4);font-size:12px;text-align:center;">${siteUrl}</p>
</td></tr>

${receptionPhone ? `
<tr><td style="background:#0f172a;border:1px solid rgba(255,255,255,0.08);border-top:none;padding:32px 40px;">
  <p style="margin:0 0 8px;color:rgba(255,255,255,0.5);font-size:11px;letter-spacing:3px;text-transform:uppercase;">🤖 AI Reception — Active</p>
  <p style="margin:0 0 12px;color:rgba(255,255,255,0.9);font-size:24px;font-weight:800;">${receptionPhone}</p>
  <p style="margin:0;color:rgba(255,255,255,0.6);font-size:14px;line-height:1.6;">
    Your AI receptionist answers every call 24/7 — qualifies leads, handles FAQs, books appointments. Forward your business line here or share it directly.
  </p>
</td></tr>` : ''}

<tr><td style="background:#111827;border:1px solid rgba(255,255,255,0.08);border-top:none;padding:32px 40px;">
  <p style="margin:0 0 12px;color:rgba(255,255,255,0.5);font-size:11px;letter-spacing:3px;text-transform:uppercase;">Your dashboard</p>
  <p style="margin:0 0 20px;color:rgba(255,255,255,0.7);font-size:15px;line-height:1.6;">
    Track your site performance, reviews, and request changes anytime.
  </p>
  <table cellpadding="0" cellspacing="0">
    <tr><td style="background:#1e293b;border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:14px 28px;">
      <a href="${portalUrl}" style="color:#60a5fa;text-decoration:none;font-size:14px;font-weight:600;">Open my dashboard →</a>
    </td></tr>
  </table>
  <p style="margin:8px 0 0;color:rgba(255,255,255,0.3);font-size:11px;">One-click login — no password. Link expires in 15 min.</p>
</td></tr>

<tr><td style="background:linear-gradient(135deg,rgba(16,185,129,0.1),rgba(5,150,105,0.05));border:1px solid rgba(16,185,129,0.25);border-top:none;padding:28px 40px;text-align:center;">
  <p style="margin:0 0 6px;color:rgba(255,255,255,0.5);font-size:11px;letter-spacing:3px;text-transform:uppercase;">⚡ Activate 3 more AI agents</p>
  <p style="margin:0 0 14px;color:rgba(255,255,255,0.8);font-size:16px;font-weight:600;">Connect Google to unlock GBP posts, review replies + weekly reports</p>
  <p style="margin:0 0 16px;color:rgba(255,255,255,0.55);font-size:13px;">Takes 30 seconds. We only access Business Profile + Search Console.</p>
  <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
    <tr><td style="background:linear-gradient(135deg,#16a34a,#0ea5e9);border-radius:10px;padding:14px 28px;">
      <a href="${connectGoogleUrl}" style="color:#fff;text-decoration:none;font-size:14px;font-weight:700;">🔗 &nbsp;Connect Google →</a>
    </td></tr>
  </table>
</td></tr>

${calendlyUrl ? `
<tr><td style="background:linear-gradient(135deg,rgba(99,102,241,0.12),rgba(79,70,229,0.06));border:1px solid rgba(99,102,241,0.25);border-top:none;padding:28px 40px;text-align:center;">
  <p style="margin:0 0 14px;color:rgba(255,255,255,0.7);font-size:15px;">Want a 15-min walkthrough? I'll show you everything your AI team is doing for you.</p>
  <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
    <tr><td style="background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);border-radius:10px;padding:12px 24px;">
      <a href="${calendlyUrl}" style="color:#a5b4fc;text-decoration:none;font-size:14px;font-weight:600;">📅 &nbsp;Book a free 15-min call — I'm open 9–6 PST</a>
    </td></tr>
  </table>
</td></tr>` : ''}

<tr><td style="background:#0f172a;border:1px solid rgba(255,255,255,0.08);border-top:none;border-radius:0 0 16px 16px;padding:24px 40px;">
  <p style="margin:0;color:rgba(255,255,255,0.3);font-size:12px;line-height:1.6;">
    Questions? Reply to this email — we typically respond within a few hours.<br>
    Powered by <strong style="color:rgba(255,255,255,0.5);">Webcrew AI</strong>
  </p>
</td></tr>

</table></td></tr></table>
</body></html>`

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromEmail,
      to,
      subject: `Your site is live — ${businessName} ✅`,
      html,
    }),
  }).catch(() => {})
}

// ─── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    return NextResponse.json({ error: 'STRIPE_WEBHOOK_SECRET not set' }, { status: 500 })
  }

  const rawBody = await req.text()
  const sig     = req.headers.get('stripe-signature') ?? ''

  if (!await verifySignature(rawBody, sig, webhookSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const event = JSON.parse(rawBody)
  const db    = await getDb()

  // ── One-time payment completed ──────────────────────────────────────────────
  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'payment_intent.succeeded'
  ) {
    const obj    = event.data.object
    const leadId = obj.metadata?.lead_id
    if (!leadId) return NextResponse.json({ ok: true })

    const { rows } = await db.query(`SELECT * FROM leads WHERE id = $1`, [leadId])
    const lead = rows[0]
    if (!lead) return NextResponse.json({ ok: true })

    // Mark paid
    await db.query(
      `UPDATE leads SET paid = TRUE, paid_at = NOW(), status = 'paid',
       stripe_session_id = $1 WHERE id = $2`,
      [obj.id, leadId]
    )

    // Attach custom domain (if pre-set)
    if (lead.custom_domain && lead.cloudflare_url) {
      const projectName = lead.cloudflare_url
        .replace(/^https?:\/\//, '')
        .replace('.pages.dev', '')
      await attachDomain(projectName, lead.custom_domain)
    }

    // Provision AI Reception
    let receptionPhone: string | null = null
    if (lead.website) {
      receptionPhone = await provisionReception(leadId, lead.website)
      if (receptionPhone) {
        await db.query(
          `UPDATE leads SET reception_phone = $1 WHERE id = $2`,
          [receptionPhone, leadId]
        )
      }
    }

    // Send welcome email with magic portal link
    if (lead.email) {
      const adminUrl  = process.env.ADMIN_URL || 'http://localhost:3010'
      const token     = await createMagicToken(lead.email)
      const portalUrl = `${adminUrl}/client/auth/${token}`
      const siteUrl   = lead.custom_domain
        ? `https://${lead.custom_domain}`
        : (lead.cloudflare_url || lead.vercel_url || '')

      await sendWelcomeEmail({
        to:               lead.email,
        businessName:     lead.name,
        siteUrl,
        portalUrl,
        connectGoogleUrl: `${adminUrl}/connect?leadId=${leadId}`,
        receptionPhone,
        calendlyUrl:      process.env.CALENDLY_URL ?? null,
      })
    }

    // Mark handed off
    await db.query(
      `UPDATE leads SET handed_off = TRUE, handed_off_at = NOW(), status = 'handed_off' WHERE id = $1`,
      [leadId]
    )

    // Create + send receipt invoice for one-time payments
    if (event.type === 'checkout.session.completed' && obj.mode === 'payment' && lead.email) {
      try {
        const stripeKey = process.env.STRIPE_SECRET_KEY ?? ''
        const amountTotal = obj.amount_total ?? 29900
        const description = `WebCrew — ${lead.name} | ${obj.metadata?.plan ?? 'site'} plan`

        // Get or create customer
        const custParams = new URLSearchParams()
        custParams.set('email', lead.email)
        custParams.set('name',  lead.name ?? '')
        custParams.set('metadata[lead_id]', leadId)
        const custResp = await fetch('https://api.stripe.com/v1/customers', {
          method: 'POST',
          headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: custParams.toString(),
        })
        const customer = await custResp.json() as any
        if (customer.id) {
          await db.query(`UPDATE leads SET stripe_customer_id = $1 WHERE id = $2`, [customer.id, leadId])

          // Invoice item
          const itemP = new URLSearchParams()
          itemP.set('customer', customer.id); itemP.set('amount', String(amountTotal))
          itemP.set('currency', 'usd');        itemP.set('description', description)
          await fetch('https://api.stripe.com/v1/invoiceitems', {
            method: 'POST', headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: itemP.toString(),
          })

          // Create + finalize + send invoice
          const invP = new URLSearchParams()
          invP.set('customer', customer.id); invP.set('collection_method', 'send_invoice')
          invP.set('days_until_due', '0');   invP.set('auto_advance', 'false')
          invP.set('metadata[lead_id]', leadId)
          const invResp  = await fetch('https://api.stripe.com/v1/invoices', { method: 'POST', headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: invP.toString() })
          const inv      = await invResp.json() as any
          if (inv.id) {
            await fetch(`https://api.stripe.com/v1/invoices/${inv.id}/finalize`, { method: 'POST', headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' })
            await fetch(`https://api.stripe.com/v1/invoices/${inv.id}/send`,     { method: 'POST', headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' })
            console.log(`[Stripe Webhook] Invoice sent — ${lead.name} | ${inv.id}`)
          }
        }
      } catch (e: any) {
        console.warn(`[Stripe Webhook] Invoice creation failed (non-fatal): ${e.message}`)
      }
    }

    console.log(`[Stripe Webhook] Handoff complete — ${lead.name}`)
  }

  // ── Subscription created ────────────────────────────────────────────────────
  if (event.type === 'customer.subscription.created') {
    const sub    = event.data.object
    const leadId = sub.metadata?.lead_id
    if (leadId) {
      await db.query(
        `UPDATE leads SET stripe_customer_id = $1, stripe_subscription_id = $2,
         subscription_active = TRUE, subscription_plan = $3 WHERE id = $4`,
        [sub.customer, sub.id, sub.metadata?.plan || 'reception', leadId]
      )
    }
  }

  // ── Subscription cancelled ──────────────────────────────────────────────────
  if (event.type === 'customer.subscription.deleted') {
    const sub    = event.data.object
    const leadId = sub.metadata?.lead_id
    if (leadId) {
      await db.query(
        `UPDATE leads SET subscription_active = FALSE WHERE id = $1`,
        [leadId]
      )
    }
  }

  return NextResponse.json({ ok: true })
}
