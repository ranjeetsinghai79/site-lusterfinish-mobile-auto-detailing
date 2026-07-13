import { runLeadHunterAgent } from './agents/lead-hunter.js'
import { runBrandAnalystAgent } from './agents/brand-analyst.js'
import { runNicheBrain } from './agents/niche-brain.js'
import { runConfigGeneratorAgent } from './agents/config-generator.js'
import { runImageGeneratorAgent } from './agents/image-generator.js'
import { runHeroVideoAgent, uploadImageToFal } from './agents/hero-video-generator.js'
import { runBuilderAgent } from './agents/builder.js'
import { runDeployerAgent } from './agents/deployer.js'
import { runSeoAgent } from './agents/seo-agent.js'
import { runAeoAgent } from './agents/aeo-agent.js'
import { runOutreachAgent } from './agents/outreach.js'
import { runSMSOutreachAgent, buildWarmTeaseSMS, sendSMS } from './agents/sms-outreach.js'
import { runSiteScorerAgent } from './agents/site-scorer.js'
import { runStripeAgent } from './agents/stripe-agent.js'
import { runDailyReport } from './agents/report-agent.js'
import { saveLead, updateLead, getLeadById } from './db/supabase.js'
import { buildBrain, buildSystemPrompt } from './reception/brain-builder.js'
import { saveReceptionConfig } from './reception/db.js'
import type { PipelineConfig, Lead } from './types.js'

// ── Auto-provision AI Reception for a deployed Tier 1 lead ───────────────────
async function autoProvisionReception(lead: Lead): Promise<string | null> {
  const siteUrl = lead.cloudflare_url ?? lead.vercel_url
  if (!siteUrl) return null
  if (!process.env.DATABASE_URL) return null

  try {
    console.log(`  [Reception] Provisioning AI brain for ${lead.name}…`)
    const brain = await buildBrain(siteUrl)
    const systemPrompt = buildSystemPrompt(brain)
    const config = await saveReceptionConfig(siteUrl, lead.name, brain, systemPrompt, lead.id)
    console.log(`  [Reception] Config saved: ${config.id}`)
    return config.id
  } catch (e: any) {
    console.error(`  [Reception] Provision failed: ${e.message}`)
    return null
  }
}

export async function runPipeline(config: PipelineConfig) {
  console.log(`\n=== AI Pipeline Starting ===`)
  console.log(`Niche: ${config.niche} | Location: ${config.location}`)
  console.log(`Target: ${config.count} leads | Dry run: ${config.dryRun ?? false}\n`)

  // Step 1: Find leads
  const leadResult = await runLeadHunterAgent(config)
  if (!leadResult.success || !leadResult.data?.length) {
    console.error('Lead hunting failed:', leadResult.error)
    return
  }

  const leads = leadResult.data
  console.log(`Found ${leads.length} leads\n`)

  const summary = { processed: 0, skipped: 0, deployed: 0, outreached: 0, errors: 0 }

  for (const rawLead of leads) {
    console.log(`\n→ ${rawLead.name} | ${rawLead.website}`)
    let lead: Lead = rawLead
    summary.processed++

    try {
      // Persist to DB (ON CONFLICT preserves status if already built+)
      const saved = await saveLead(lead)
      if (saved?.id) lead = { ...lead, id: saved.id, status: saved.status }

      // Skip leads already through the expensive build/deploy steps
      const DONE = new Set(['built','deployed','outreach_sent','sms_sent',
        'conversation_active','meeting_scheduled','payment_link_sent','paid','handed_off'])
      if (DONE.has(lead.status)) {
        console.log(`  [skip] Already ${lead.status} — ${lead.vercel_url ?? lead.cloudflare_url ?? ''}`)
        summary.skipped++
        continue
      }

      // Step 2: Score existing website (tier2 leads only)
      // Track A: tier1 (no website) → build from scratch
      // Track B: tier1 + site_broken → build fresh, "site was down" SMS
      // Track C: tier2 (poor quality) → warm tease SMS, build only on YES
      if (lead.tier === 'tier2' && lead.website) {
        const scoreResult = await runSiteScorerAgent(lead)
        if (scoreResult.success && scoreResult.data) {
          lead = scoreResult.data
          await updateLead(lead)
          // Broken site → promote to tier1 so it goes through full build pipeline
          if (lead.site_broken) {
            console.log(`  Site broken → promoting to tier1 build pipeline`)
            lead = { ...lead, tier: 'tier1' }
          }
        }
      }

      // Step 3: Analyze brand
      const analyzeResult = await runBrandAnalystAgent(lead)
      if (!analyzeResult.success) {
        console.log(`  [!] Brand analysis failed: ${analyzeResult.error}`)
        summary.errors++
        continue
      }
      lead = analyzeResult.data!
      // Enrich email from scraped brand data if Places API didn't return one
      if (!lead.email && lead.brand_data?.email) {
        lead = { ...lead, email: lead.brand_data.email }
      }
      // Enrich phone from brand data if Places API missed it
      if (!lead.phone && lead.brand_data?.phone) {
        lead = { ...lead, phone: lead.brand_data.phone }
      }
      await updateLead(lead)
      const contactInfo = [lead.email && `email:${lead.email}`, lead.phone && `phone:${lead.phone}`].filter(Boolean).join(' | ')
      console.log(`  Brand analyzed: ${lead.brand_data?.name} | ${contactInfo || 'NO CONTACT — manual outreach'}`)

      // Step 4: Outreach (pitch — no build yet)
      // Build is triggered manually from admin when lead confirms interest.
      const hasContact = !!(lead.email || lead.phone)
      if (!hasContact) {
        console.log(`  [!] No contact info — skip outreach, review manually`)
        await updateLead({ ...lead, status: 'outreach_sent' })
      } else {
        const outreachResult = await runOutreachAgent(lead)
        if (outreachResult.success) {
          lead = outreachResult.data!
          await updateLead(lead)
          const via = [lead.email && 'email', lead.phone && 'sms'].filter(Boolean).join('+')
          console.log(`  Pitch sent via ${via} → ${lead.email ?? lead.phone}`)
          summary.outreached++
        } else {
          console.log(`  [!] Outreach failed: ${outreachResult.error}`)
        }
      }

      // Step 10: Pre-generate Stripe payment link (ready when lead responds)
      if (process.env.STRIPE_SECRET_KEY) {
        const stripeResult = await runStripeAgent(lead, 'create_link')
        if (stripeResult.success && stripeResult.data) {
          lead = { ...lead, stripe_payment_url: stripeResult.data.paymentUrl }
          await updateLead(lead)
          console.log(`  Stripe payment link ready`)
        }
      }

    } catch (e: any) {
      console.error(`  [ERROR] ${lead.name}:`, e.message)
      console.error(`  [STACK]`, e.stack?.split('\n').slice(0, 4).join('\n  '))
      await updateLead({ ...lead, status: 'error' })
      summary.errors++
    }
  }

  console.log('\n=== Pipeline Complete ===')
  console.log(`Processed: ${summary.processed}`)
  console.log(`Skipped (good sites): ${summary.skipped}`)
  console.log(`Deployed: ${summary.deployed}`)
  console.log(`Emails sent: ${summary.outreached}`)
  console.log(`Errors: ${summary.errors}`)

  // Daily report — append today's results to Google Sheet
  await runDailyReport()
}

// ─── Run pipeline for a single lead already in DB (triggered from admin) ─────
// Skips lead-hunter. Fetches lead by ID, runs full agent chain.
export async function runPipelineForLead(leadId: string, config: Partial<PipelineConfig> = {}) {
  const lead0 = await getLeadById(leadId)
  if (!lead0) throw new Error(`Lead ${leadId} not found`)

  const cfg: PipelineConfig = {
    niche:    (lead0.niche as any) ?? 'hvac',
    location: lead0.city ? `${lead0.city}, ${lead0.state ?? 'US'}` : 'US',
    city:     lead0.city ?? '',
    state:    lead0.state ?? '',
    count:    1,
    dryRun:   false,
    templateOwner: process.env.TEMPLATE_OWNER ?? 'ranjeetsinghai79',
    templateRepo:  process.env.TEMPLATE_REPO  ?? 'websitedeveloper',
    deployOwner:   process.env.DEPLOY_OWNER   ?? 'ranjeetsinghai79',
    ...config,
  }

  console.log(`\n=== Pipeline Trigger: ${lead0.name} (${leadId}) ===`)
  let lead: Lead = lead0

  // Brand analysis
  const analyzeResult = await runBrandAnalystAgent(lead)
  if (!analyzeResult.success) throw new Error(`Brand analysis failed: ${analyzeResult.error}`)
  lead = analyzeResult.data!
  if (!lead.email && lead.brand_data?.email) lead = { ...lead, email: lead.brand_data.email }
  if (!lead.phone && lead.brand_data?.phone) lead = { ...lead, phone: lead.brand_data.phone }
  await updateLead(lead)

  // Niche brain
  const nicheProfile = await runNicheBrain(lead)
  lead = { ...lead, niche_profile: nicheProfile }
  await updateLead(lead)

  // Config generation
  const configResult = await runConfigGeneratorAgent(lead)
  if (!configResult.success) throw new Error(`Config generation failed: ${configResult.error}`)
  lead = configResult.data!
  await updateLead(lead)

  // Images
  const imgResult  = await runImageGeneratorAgent(lead, lead.niche_profile)
  const heroImages = imgResult.success ? (imgResult.data?.images ?? null) : null

  // Video (non-blocking if fails)
  let heroVideoBuffer: Buffer | null = null
  if (heroImages?.['hero-1'] && process.env.FAL_KEY) {
    const imgUrl = await uploadImageToFal(heroImages['hero-1'])
    if (imgUrl) {
      const vidResult = await runHeroVideoAgent(lead, imgUrl, lead.niche_profile)
      if (vidResult.success && vidResult.data) {
        heroVideoBuffer = vidResult.data.buffer
        lead = { ...lead, hero_video_url: vidResult.data.url }
      }
    }
  }

  // Build
  const buildResult = await runBuilderAgent(lead, cfg, heroImages, heroVideoBuffer)
  if (!buildResult.success) throw new Error(`Build failed: ${buildResult.error}`)
  lead = buildResult.data!
  await updateLead(lead)

  // Deploy
  const deployResult = await runDeployerAgent(lead)
  if (!deployResult.success) throw new Error(`Deploy failed: ${deployResult.error}`)
  lead = deployResult.data!
  await updateLead(lead)
  console.log(`[Trigger] LIVE: ${lead.cloudflare_url ?? lead.vercel_url}`)

  // Auto-provision AI Reception (Tier 1 only — Tier 2 auto-provisions via CF Worker on YES)
  if (!lead.reception_config_id) {
    const configId = await autoProvisionReception(lead)
    if (configId) {
      lead = { ...lead, reception_config_id: configId }
      await updateLead(lead)
    }
  }

  // SEO + AEO
  await runSeoAgent(lead)
  await runAeoAgent(lead)

  // Outreach
  if (lead.email) {
    const r = await runOutreachAgent(lead)
    if (r.success) { lead = r.data!; await updateLead(lead) }
  }
  if (lead.phone && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_FROM_NUMBER) {
    const r = await runSMSOutreachAgent(lead)
    if (r.success) { lead = r.data!; await updateLead(lead) }
  }

  // Stripe payment link
  if (process.env.STRIPE_SECRET_KEY) {
    const r = await runStripeAgent(lead, 'create_link')
    if (r.success && r.data) {
      lead = { ...lead, stripe_payment_url: r.data.paymentUrl }
      await updateLead(lead)
    }
  }

  console.log(`[Trigger] Done: ${lead.name} | ${lead.cloudflare_url ?? lead.vercel_url}`)
  return lead
}

// ─── Track C: warm tease for tier2 (poor but loading website) ────────────────

async function sendWarmTeaseOutreach(lead: Lead, config: PipelineConfig) {
  if (!lead.phone) {
    console.log(`  [TrackC] No phone for ${lead.name} — skip`)
    await updateLead({ ...lead, status: 'outreach_sent' })
    return
  }

  if (config.dryRun) {
    console.log(`  [TrackC DRY RUN] Would send warm tease to ${lead.name} (${lead.phone})`)
    return
  }

  const msg = buildWarmTeaseSMS(lead)

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_FROM_NUMBER) {
    try {
      await sendSMS(lead.phone, msg)
      console.log(`  [TrackC] Warm tease SMS → ${lead.phone}`)
    } catch (e: any) {
      console.log(`  [TrackC] SMS error: ${e.message}`)
    }
  } else {
    console.log(`  [TrackC] Would send warm tease to ${lead.phone} — add TWILIO_* to enable`)
    console.log(`  Message: ${msg.slice(0, 100)}...`)
  }

  await updateLead({ ...lead, status: 'outreach_sent', sms_sent: true, sms_sent_at: new Date().toISOString() })
}

