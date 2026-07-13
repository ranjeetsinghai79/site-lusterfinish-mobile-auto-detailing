/**
 * sheets-outreach.ts
 *
 * Reads all 12 Google Sheets tabs, finds uncontacted leads with email,
 * sends cold intro email (T1: free demo pitch, T2: free audit pitch),
 * marks column S "SENT YYYY-MM-DD" when done.
 *
 * Usage:
 *   cd pipeline && npx tsx src/scripts/sheets-outreach.ts
 *   SHEET_TAB="MEDSPAS" npx tsx src/scripts/sheets-outreach.ts    # one tab
 *   BATCH_SIZE=50 npx tsx src/scripts/sheets-outreach.ts          # more per run
 *   DRY_RUN=true npx tsx src/scripts/sheets-outreach.ts           # preview only
 */

import 'dotenv/config'
import { readSheetRows, updateSheetCell } from '../tools/google-sheets.js'

const SPREADSHEET_ID = process.env.LEADS_SHEET_ID!
const DRY_RUN        = process.env.DRY_RUN === 'true'
const BATCH_SIZE     = parseInt(process.env.BATCH_SIZE ?? '20', 10)
const RESEND_KEY     = process.env.RESEND_API_KEY!
const FROM_EMAIL     = process.env.OUTREACH_FROM_EMAIL ?? 'hello@webcrew.app'

const ALL_TABS = [
  'Local SMBs',
  'MEDSPAS',
  'INDIA_MEDSPAS',
  'USA_DentalOffices',
  'INDIA_DentalOffices',
  'USA_Salons',
  'USA_BarberShops',
  'USA_FinancialAdvisorsandInsuranceAgents',
  'USA_RealEstateAgents',
  'USA_Restaurants',
  'India_Restaurants',
  'USA_LawFirms',
]

// Column indices (0-based) — 18-column header from scrape-universal.ts
const COL = {
  NAME:        1,   // B
  NICHE:       2,   // C
  CITY:        3,   // D
  EMAIL:       7,   // H
  HAS_WEBSITE: 8,   // I
  WEBSITE_URL: 9,   // J
  TIER:        16,  // Q
  OUTREACH:    18,  // S — written by this script
}

async function sendEmail(params: { to: string; subject: string; html: string }): Promise<boolean> {
  if (!RESEND_KEY) { console.error('[Sheets Outreach] No RESEND_API_KEY'); return false }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: params.to, subject: params.subject, html: params.html }),
  })
  if (!res.ok) { console.error('[Sheets Outreach] Resend error:', await res.text()); return false }
  return true
}

function buildT1Email(name: string, niche: string, city: string): { subject: string; html: string } {
  const subject = `We built ${name} a free website — see it live`
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr>
          <td style="background:linear-gradient(135deg,#2563EB 0%,#7C3AED 100%);padding:36px 40px 28px;">
            <p style="margin:0 0 8px;color:rgba(255,255,255,0.7);font-size:11px;letter-spacing:3px;text-transform:uppercase;">WebCrew — Website Studio</p>
            <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;">We'd love to build a free website for ${name}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 20px;color:#374151;font-size:16px;line-height:1.7;">
              Hi — we noticed ${name} doesn't have a website yet. We'd love to change that, for free.
            </p>
            <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.7;">
              We build cinematic, lead-generating websites for ${niche} businesses in ${city} overnight — literally while you sleep. You get a text with your live link in the morning. Pay <strong>$299 one-time</strong> only if you love it.
            </p>
            <table cellpadding="0" cellspacing="8" style="margin:0 0 24px;">
              ${[
                ['✓', 'Full website, live in under 12 hours'],
                ['✓', 'Mobile-first, blazing fast on Cloudflare CDN'],
                ['✓', 'Copy written in your voice, for your niche'],
                ['✓', '$299 one-time only if you love it — zero risk'],
              ].map(([icon, text]) => `
              <tr>
                <td style="color:#2563EB;font-weight:700;padding-right:10px;font-size:14px;">${icon}</td>
                <td style="color:#374151;font-size:14px;">${text}</td>
              </tr>`).join('')}
            </table>
            <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td style="background:linear-gradient(135deg,#2563EB,#7C3AED);border-radius:10px;">
                  <a href="https://webcrew.app?utm_source=sheets&utm_medium=email&utm_campaign=t1-cold" style="display:block;padding:16px 32px;color:#fff;text-decoration:none;font-size:15px;font-weight:700;text-align:center;">
                    Get My Free Website →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6;">
              Questions? Reply to this email.<br>
              To unsubscribe from future emails, reply "no thanks" and we'll remove you immediately.<br>
              WebCrew · United States · hello@webcrew.app
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`
  return { subject, html }
}

function buildT2Email(name: string, niche: string, website: string): { subject: string; html: string } {
  const subject = `Quick scan of ${name}'s website — 3 things we found`
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);padding:36px 40px 28px;">
            <p style="margin:0 0 8px;color:rgba(255,255,255,0.5);font-size:11px;letter-spacing:3px;text-transform:uppercase;">Free Website Audit — ${name}</p>
            <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;">We reviewed your ${niche} site</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.4);font-size:12px;">${website}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 20px;color:#374151;font-size:16px;line-height:1.7;">
              Hi — we ran a quick scan of your site and spotted a few areas likely costing you customers every week.
            </p>
            <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
              ${[
                ['🐢', 'Load Speed', 'Most local business sites load in 4–8s on mobile. Visitors leave after 3s.'],
                ['📱', 'Mobile Experience', 'Google ranks mobile experience above desktop. Unresponsive = invisible.'],
                ['📞', 'No 24/7 Call Answer', 'Unanswered calls go to competitors. AI Reception fixes this for $49/mo.'],
              ].map(([icon, title, desc], idx, arr) => `
              <tr style="${idx < arr.length - 1 ? 'border-bottom:1px solid #e5e7eb;' : ''}">
                <td style="padding:14px 18px;">
                  <table cellpadding="0" cellspacing="0"><tr>
                    <td style="padding-right:14px;font-size:20px;vertical-align:top;">${icon}</td>
                    <td>
                      <strong style="color:#111827;font-size:14px;display:block;">${title}</strong>
                      <span style="color:#6b7280;font-size:13px;">${desc}</span>
                    </td>
                  </tr></table>
                </td>
              </tr>`).join('')}
            </table>
            <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.7;">
              We fix all of this — and build you a faster, more beautiful site — for <strong>$299 one-time</strong>. Plus $49/month gets you AI answering every call, 24/7 Google Business posts, and monthly SEO reports.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td style="background:linear-gradient(135deg,#2563EB,#7C3AED);border-radius:10px;">
                  <a href="https://webcrew.app?utm_source=sheets&utm_medium=email&utm_campaign=t2-cold" style="display:block;padding:16px 32px;color:#fff;text-decoration:none;font-size:15px;font-weight:700;text-align:center;">
                    Get My Free Audit Report →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6;">
              No obligation. Reply "not interested" and we'll remove you immediately.<br>
              To unsubscribe from future emails, reply "no thanks".<br>
              WebCrew · United States · hello@webcrew.app
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`
  return { subject, html }
}

async function processTab(
  tabName: string,
  stats: { sent: number; skipped: number; noEmail: number },
): Promise<void> {
  console.log(`\n── Tab: ${tabName} ──`)
  const rows = await readSheetRows({ spreadsheetId: SPREADSHEET_ID, sheetName: tabName })
  if (!rows.length) { console.log('  Empty tab'); return }

  console.log(`  ${rows.length - 1} data rows`)

  for (let i = 1; i < rows.length; i++) {
    if (stats.sent >= BATCH_SIZE) break

    const row      = rows[i]
    const sheetRow = i + 1  // 1-indexed for Sheets API

    const email      = row[COL.EMAIL]?.trim()
    const name       = row[COL.NAME]?.trim() || 'your business'
    const niche      = row[COL.NICHE]?.trim() || 'local business'
    const city       = row[COL.CITY]?.trim() || 'your area'
    const tier       = row[COL.TIER]?.trim() || 'tier1'
    const website    = row[COL.WEBSITE_URL]?.trim() || ''
    const outreachSt = row[COL.OUTREACH]?.trim()

    if (outreachSt?.startsWith('SENT')) { stats.skipped++; continue }
    if (!email || !email.includes('@')) { stats.noEmail++; continue }

    const isTier2 = tier === 'tier2' && !!website
    const { subject, html } = isTier2
      ? buildT2Email(name, niche, website)
      : buildT1Email(name, niche, city)

    const today = new Date().toISOString().slice(0, 10)

    if (DRY_RUN) {
      console.log(`  [DRY] Row ${sheetRow}: ${name} <${email}> → ${isTier2 ? 'T2' : 'T1'} — "${subject}"`)
      stats.sent++
      continue
    }

    const ok = await sendEmail({ to: email, subject, html })
    if (ok) {
      await updateSheetCell({
        spreadsheetId: SPREADSHEET_ID,
        sheetName:     tabName,
        row:           sheetRow,
        col:           COL.OUTREACH + 1,  // 1-indexed col
        value:         `SENT ${today}`,
      })
      console.log(`  ✓ Row ${sheetRow}: ${name} <${email}>`)
      stats.sent++
    } else {
      console.log(`  ✗ Row ${sheetRow}: ${name} <${email}> — email failed`)
    }

    // 200ms between emails to stay within Resend rate limits
    await new Promise(r => setTimeout(r, 200))
  }
}

async function main() {
  if (!SPREADSHEET_ID) { console.error('LEADS_SHEET_ID env var missing'); process.exit(1) }
  if (!RESEND_KEY && !DRY_RUN) { console.error('RESEND_API_KEY env var missing'); process.exit(1) }

  const targetTab = process.env.SHEET_TAB
  const tabs = targetTab ? [targetTab] : ALL_TABS

  console.log(`=== Sheets Outreach ===`)
  console.log(`Tabs: ${tabs.join(', ')}`)
  console.log(`Batch: ${BATCH_SIZE} emails | Dry run: ${DRY_RUN}`)

  const stats = { sent: 0, skipped: 0, noEmail: 0 }

  for (const tab of tabs) {
    if (stats.sent >= BATCH_SIZE) break
    await processTab(tab, stats)
  }

  console.log(`\n=== Done ===`)
  console.log(`Sent:         ${stats.sent}`)
  console.log(`Already sent: ${stats.skipped}`)
  console.log(`No email:     ${stats.noEmail}`)
}

main().catch(e => { console.error(e); process.exit(1) })
