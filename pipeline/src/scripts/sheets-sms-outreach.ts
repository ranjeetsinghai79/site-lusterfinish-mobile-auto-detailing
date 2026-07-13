/**
 * sheets-sms-outreach.ts
 *
 * SMS outreach for ALL scraped leads in Google Sheet.
 * Reads phone (col G), can_sms (col V), sends T1/T2 pitch via Twilio.
 * Marks col W "SMS-SENT YYYY-MM-DD" — skips already-sent rows on next run.
 *
 * Tier 1 (no website): free demo site pitch → webcrew.app
 * Tier 2 (has website): AI reception pitch → webcrew.app
 *
 * Usage:
 *   cd pipeline && npx tsx src/scripts/sheets-sms-outreach.ts
 *   SHEET_TAB="Local SMBs" BATCH_SIZE=200 npx tsx src/scripts/sheets-sms-outreach.ts
 *   DRY_RUN=true BATCH_SIZE=50 npx tsx src/scripts/sheets-sms-outreach.ts
 *
 * Recommended daily runs:
 *   Week 1-2: BATCH_SIZE=500  (ramp up, test delivery rates)
 *   Week 3+ : BATCH_SIZE=1000 (safe 10DLC limit per number)
 *   Scale   : BATCH_SIZE=3000 (max 10DLC standard = 3,600/day)
 *
 * Cost: $0.0079/SMS (Twilio). 1000/day = $237/month.
 */

import 'dotenv/config'
import { readSheetRows, updateSheetCell } from '../tools/google-sheets.js'

const SPREADSHEET_ID = process.env.LEADS_SHEET_ID!
const DRY_RUN        = process.env.DRY_RUN === 'true'
const BATCH_SIZE     = parseInt(process.env.BATCH_SIZE ?? '200', 10)
const SHEET_TAB      = process.env.SHEET_TAB ?? ''

// Twilio credentials
const TWILIO_SID  = process.env.TWILIO_ACCOUNT_SID!
const TWILIO_AUTH = process.env.TWILIO_AUTH_TOKEN!
const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER!
const SMS_DRY_RUN = process.env.SMS_DRY_RUN === 'true'

// Column indices (0-based) in the 22-col header from scrape-universal.ts
const COL = {
  NAME:       1,   // B — Business Name
  NICHE:      2,   // C — Niche / Category
  CITY:       3,   // D — City
  PHONE:      6,   // G — Phone
  HAS_WEBSITE: 8,  // I — Has Website (YES/NO)
  WEBSITE:    9,   // J — Website URL
  TIER:       16,  // Q — Tier (tier1/tier2)
  PHONE_TYPE: 20,  // U — Phone Type
  CAN_SMS:    21,  // V — Can SMS (YES/NO)
  SMS_SENT:   22,  // W — written by this script: "SMS-SENT YYYY-MM-DD"
}

// Priority tabs — ordered by conversion potential
const ALL_TABS = [
  'Local SMBs',
  'MEDSPAS',
  'USA_Salons',
  'USA_BarberShops',
  'USA_NailStudios',
  'USA_SkinClinics',
  'USA_IVTherapy',
  'USA_FinancialAdvisorsandInsuranceAgents',
  'USA_Restaurants',
  'USA_DentalOffices',
  'USA_LawFirms',
  'USA_RealEstateAgents',
]

// Live demo URLs per niche — lead can SEE a real site, not just webcrew.app
const DEMO_URLS: Record<string, string> = {
  hvac:                   'demo-hvac.pages.dev',
  roofing:                'demo-roofing.pages.dev',
  plumbing:               'demo-plumbing.pages.dev',
  cleaning:               'demo-cleaning.pages.dev',
  landscaping:            'demo-landscaping.pages.dev',
  'auto-detailing':       'demo-auto-detailing.pages.dev',
  remodeling:             'demo-remodeling.pages.dev',
  dentist:                'demo-dentist.pages.dev',
  medspa:                 'demo-medspa.pages.dev',
  'medspa-usa':           'demo-medspa.pages.dev',
  'botox-clinic':         'demo-medspa.pages.dev',
  'aesthetic-clinic':     'demo-medspa.pages.dev',
  'skin-clinic':          'demo-medspa.pages.dev',
  'cosmetic-dermatology': 'demo-medspa.pages.dev',
  'laser-clinic':         'demo-medspa.pages.dev',
  salon:                  'demo-salon.pages.dev',
  barbershop:             'demo-barbershop.pages.dev',
}

function buildSmsBody(name: string, niche: string, city: string, isTier2: boolean): string {
  const label = name.length > 22 ? name.slice(0, 20) + '…' : name
  const nicheKey = niche.toLowerCase().replace(/\s+/g, '-')
  const demoUrl = DEMO_URLS[nicheKey] ?? 'webcrew.app'

  if (isTier2) {
    // Has website — AI reception pitch (~155 chars)
    return `Hi ${label}! AI receptionist for your ${niche} in ${city} — answers calls 24/7, $49/mo. Free trial: webcrew.app Reply YES or STOP -WebCrew`
  } else {
    // No website — show actual demo URL (~155 chars max)
    return `Hi ${label}! Free ${niche} site we built for ${city}: ${demoUrl} Want yours customized? Reply YES. STOP to opt out -WebCrew`
  }
}

async function sendSms(to: string, body: string): Promise<boolean> {
  if (!TWILIO_SID || !TWILIO_AUTH || !TWILIO_FROM) {
    console.error('[SMS] Missing Twilio env vars (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER)')
    return false
  }

  // Normalize to E.164
  const digits = to.replace(/\D/g, '')
  if (digits.length < 10) return false
  const e164 = digits.startsWith('1') ? `+${digits}` : `+1${digits}`

  if (SMS_DRY_RUN) {
    console.log(`  [DRY-TWILIO] Would send to ${e164}: "${body.slice(0, 60)}..."`)
    return true
  }

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_AUTH}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: e164, From: TWILIO_FROM, Body: body }).toString(),
    }
  )

  const data = await res.json() as any
  if (!res.ok) {
    console.warn(`  [SMS] Twilio error: ${data?.message ?? JSON.stringify(data)}`)
    return false
  }
  return true
}

async function processTab(
  tabName: string,
  stats: { sent: number; skipped: number; noPhone: number; noSms: number },
): Promise<void> {
  console.log(`\n── Tab: ${tabName} ──`)

  let rows: string[][]
  try {
    rows = await readSheetRows({ spreadsheetId: SPREADSHEET_ID, sheetName: tabName })
  } catch (e: any) {
    console.log(`  ✗ Could not read tab: ${e.message}`)
    return
  }

  if (rows.length <= 1) { console.log('  Empty tab'); return }
  console.log(`  ${rows.length - 1} data rows`)

  for (let i = 1; i < rows.length; i++) {
    if (stats.sent >= BATCH_SIZE) break

    const row      = rows[i]
    const sheetRow = i + 1  // 1-indexed

    const phone    = row[COL.PHONE]?.trim()
    const canSms   = row[COL.CAN_SMS]?.trim()?.toUpperCase()
    const smsSent  = row[COL.SMS_SENT]?.trim()
    const name     = row[COL.NAME]?.trim() || 'Business'
    const niche    = row[COL.NICHE]?.trim() || 'local business'
    const city     = row[COL.CITY]?.trim() || 'your area'
    const tier     = row[COL.TIER]?.trim()?.toLowerCase()
    const hasWeb   = row[COL.HAS_WEBSITE]?.trim()?.toUpperCase()

    // Skip already-sent
    if (smsSent?.startsWith('SMS-SENT')) { stats.skipped++; continue }

    // Skip no phone
    if (!phone || phone.length < 10) { stats.noPhone++; continue }

    // Skip confirmed no-SMS (landlines in non-US, toll-free, etc)
    if (canSms === 'NO') { stats.noSms++; continue }

    const isTier2 = tier === 'tier2' || hasWeb === 'YES'
    const body = buildSmsBody(name, niche, city, isTier2)
    const today = new Date().toISOString().slice(0, 10)

    if (DRY_RUN) {
      console.log(`  [DRY] Row ${sheetRow}: ${name} (${phone}) → ${isTier2 ? 'T2 AI-reception' : 'T1 free-site'} pitch`)
      stats.sent++
      continue
    }

    const ok = await sendSms(phone, body)
    if (ok) {
      // Mark col W as SMS-SENT
      try {
        await updateSheetCell({
          spreadsheetId: SPREADSHEET_ID,
          sheetName:     tabName,
          row:           sheetRow,
          col:           COL.SMS_SENT + 1,  // 1-indexed
          value:         `SMS-SENT ${today}`,
        })
      } catch { /* non-fatal — row already counted as sent */ }

      const pitch = isTier2 ? '[T2 AI-reception]' : '[T1 free-site]'
      console.log(`  ✓ [${stats.sent + 1}/${BATCH_SIZE}] ${pitch} ${name} | ${phone} | ${city}`)
      stats.sent++
    } else {
      console.log(`  ✗ ${name} | ${phone} — SMS failed`)
    }

    // 350ms between sends — stays well under Twilio 10DLC rate limit
    if (!DRY_RUN && !SMS_DRY_RUN) {
      await new Promise(r => setTimeout(r, 350))
    }
  }
}

async function main() {
  if (!SPREADSHEET_ID) { console.error('LEADS_SHEET_ID not set'); process.exit(1) }
  if (!DRY_RUN && !TWILIO_SID) { console.error('TWILIO_ACCOUNT_SID not set'); process.exit(1) }

  const tabs = SHEET_TAB ? [SHEET_TAB] : ALL_TABS

  console.log('═══════════════════════════════════════════════════════════')
  console.log(`📱  Sheets SMS Outreach`)
  console.log(`    Tabs      : ${tabs.join(', ')}`)
  console.log(`    Batch size: ${BATCH_SIZE} messages`)
  console.log(`    Dry run   : ${DRY_RUN}`)
  console.log(`    SMS dry   : ${SMS_DRY_RUN}`)
  console.log(`    Est cost  : $${(BATCH_SIZE * 0.0079).toFixed(2)} (at $0.0079/SMS)`)
  console.log('═══════════════════════════════════════════════════════════')

  const stats = { sent: 0, skipped: 0, noPhone: 0, noSms: 0 }

  for (const tab of tabs) {
    if (stats.sent >= BATCH_SIZE) break
    await processTab(tab, stats)
  }

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('SUMMARY')
  console.log(`  Sent         : ${stats.sent}`)
  console.log(`  Already sent : ${stats.skipped}`)
  console.log(`  No phone     : ${stats.noPhone}`)
  console.log(`  No SMS       : ${stats.noSms}`)
  if (!DRY_RUN && !SMS_DRY_RUN) {
    console.log(`  Cost         : ~$${(stats.sent * 0.0079).toFixed(2)}`)
  }
  console.log('═══════════════════════════════════════════════════════════')
}

main().catch(e => { console.error(e); process.exit(1) })
