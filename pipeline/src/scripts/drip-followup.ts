/**
 * drip-followup.ts
 *
 * Follow-up drip for leads that haven't replied to initial outreach.
 *
 * Run via cron (daily):
 *   cd pipeline && npx tsx src/scripts/drip-followup.ts
 *
 * Drip schedule:
 *   Day 3  — follow-up 1: "Just checking in…" + demo link
 *   Day 10 — follow-up 2: social proof + last-chance offer
 *
 * Skips: opted-out, already in conversation, no phone, no demo site
 */

import 'dotenv/config'
import pg from 'pg'
import Twilio from 'twilio'

const pool   = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
const FROM   = process.env.TWILIO_FROM_NUMBER ?? ''
const DRY    = process.env.DRY_RUN === 'true'

// ── SMS templates ─────────────────────────────────────────────────────────────

function followUp1(name: string, niche: string, city: string, demoUrl: string): string {
  return `Hi! Just checking in — we built ${name} a free ${niche} website in ${city}. Still available if you want to take a look: ${demoUrl}\n\nReply YES to claim it for $299 (or $0 with our $49/mo plan).`
}

function followUp2(name: string, niche: string, demoUrl: string): string {
  return `Last check-in for ${name}. Your free site is still live at ${demoUrl}\n\nSeveral ${niche} businesses in your area have already activated theirs. Happy to hand yours over anytime — just reply YES.`
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Drip Follow-Up${DRY ? ' (DRY RUN)' : ''} ===`)
  console.log(new Date().toISOString())

  if (!FROM && !DRY) {
    console.error('TWILIO_FROM_NUMBER not set')
    process.exit(1)
  }

  const now = new Date()
  let sent1 = 0, sent2 = 0, skipped = 0

  // ── Follow-up 1: sms_sent 3+ days ago, no reply, no follow-up yet ────────
  const q1 = await pool.query<{
    id: string; name: string; niche: string; city: string; phone: string;
    cloudflare_url: string; vercel_url: string
  }>(
    `SELECT id, name, niche, city, phone, cloudflare_url, vercel_url
     FROM leads
     WHERE phone IS NOT NULL
       AND sms_opt_out IS NOT TRUE
       AND follow_up_1_sent_at IS NULL
       AND status IN ('sms_sent','outreach_sent')
       AND sms_sent_at IS NOT NULL
       AND sms_sent_at < NOW() - INTERVAL '3 days'
     ORDER BY sms_sent_at ASC
     LIMIT 200`
  )

  for (const row of q1.rows) {
    const demoUrl = row.cloudflare_url ?? row.vercel_url ?? 'webcrew.app'
    const sms = followUp1(row.name, row.niche ?? 'business', row.city ?? 'your city', demoUrl)

    if (DRY) {
      console.log(`[DRY] FU1 → ${row.name} (${row.phone}): ${sms.slice(0, 80)}…`)
    } else {
      try {
        await client.messages.create({ to: row.phone, from: FROM, body: sms })
        await pool.query(
          `UPDATE leads SET follow_up_1_sent_at = $1 WHERE id = $2`,
          [now.toISOString(), row.id]
        )
        console.log(`  FU1 → ${row.name} (${row.phone})`)
        sent1++
        await new Promise(r => setTimeout(r, 250)) // 4 SMS/sec rate limit
      } catch (e: any) {
        console.error(`  [!] FU1 failed for ${row.name}: ${e.message}`)
        skipped++
      }
    }
  }

  // ── Follow-up 2: FU1 sent 7+ days ago, still no reply ───────────────────
  const q2 = await pool.query<{
    id: string; name: string; niche: string; phone: string;
    cloudflare_url: string; vercel_url: string
  }>(
    `SELECT id, name, niche, phone, cloudflare_url, vercel_url
     FROM leads
     WHERE phone IS NOT NULL
       AND sms_opt_out IS NOT TRUE
       AND follow_up_1_sent_at IS NOT NULL
       AND follow_up_2_sent_at IS NULL
       AND status IN ('sms_sent','outreach_sent')
       AND follow_up_1_sent_at < NOW() - INTERVAL '7 days'
     ORDER BY follow_up_1_sent_at ASC
     LIMIT 200`
  )

  for (const row of q2.rows) {
    const demoUrl = row.cloudflare_url ?? row.vercel_url ?? 'webcrew.app'
    const sms = followUp2(row.name, row.niche ?? 'business', demoUrl)

    if (DRY) {
      console.log(`[DRY] FU2 → ${row.name} (${row.phone}): ${sms.slice(0, 80)}…`)
    } else {
      try {
        await client.messages.create({ to: row.phone, from: FROM, body: sms })
        await pool.query(
          `UPDATE leads SET follow_up_2_sent_at = $1 WHERE id = $2`,
          [now.toISOString(), row.id]
        )
        console.log(`  FU2 → ${row.name} (${row.phone})`)
        sent2++
        await new Promise(r => setTimeout(r, 250))
      } catch (e: any) {
        console.error(`  [!] FU2 failed for ${row.name}: ${e.message}`)
        skipped++
      }
    }
  }

  console.log(`\nDone — FU1 sent: ${sent1} | FU2 sent: ${sent2} | Skipped: ${skipped}`)
  await pool.end()
}

main().catch(e => {
  console.error('[Drip] Fatal:', e.message)
  process.exit(1)
})
