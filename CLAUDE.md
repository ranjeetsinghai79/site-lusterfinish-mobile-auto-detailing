# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

AI Employee pipeline for local businesses. Two systems:

1. **Pipeline** — two-track outreach engine:
   - **Tier 1 (no website)** → scrape brand → generate config → build demo site → deploy to Cloudflare Pages → email + SMS: "we built you a free demo site"
   - **Tier 2 (has website)** → brand scrape for contact info only → skip build/deploy entirely → email + SMS: AI Reception pitch ("we built you a 24/7 AI receptionist, test it")
   Fully automated, zero human steps per lead.
2. **Templates** — 25 niche-specific Next.js sites (hvac, roofing, dentist, medspa, lawfirm, remodeling, cleaning, junk-removal, daycare, auto-detailing, restaurant, luxury-realestate, salon, barbershop, plumbing, landscaping, pressure-washing, epoxy-flooring, basement-waterproofing, foundation-repair, septic-services, tree-services, skin-clinic, iv-therapy, nail-studio). Config-driven: swap `src/lib/config.ts` and the site is a different business.
3. **AI Reception** — Gemini Live (native audio) + Twilio Media Streams. Answers inbound calls for deployed clients. Server: `pipeline/src/reception/` — deployed to GCP Cloud Run (`gen-lang-client-0844283339`, `us-central1`). Live URL: `https://ai-reception-571925663575.us-central1.run.app`

## Monorepo Workspaces

```
packages/core        → @core/web — shared component library (sections, hooks, types, effects)
templates/*          → 12 niche Next.js sites — import from @core/web
pipeline/            → AI pipeline (Node/TypeScript, tsx runtime)
admin/               → internal dashboard — Neon DB stats, leads, funnel (Next.js, port 3010)
api/                 → Cloudflare Worker — contact form handler, SMS/email, Sheets write
my-website/          → WebsiteDeveloper marketing landing page (port 3001)
webcrew/             → Webcrew marketing site (port 3002)
```

## Commands

```bash
# Pipeline (run from monorepo root)
npm run pipeline:dry          # dry-run (no GitHub/Cloudflare/email)
npm run pipeline              # live run
npm run pipeline:auto         # auto-run loop (pipeline/src/auto-run.ts)
npm run retention --workspace=pipeline  # run GBP + reviews + analytics agents

# Scraping (run from pipeline/ or via workspace)
cd pipeline && npm run scrape                          # scrape Google Maps (env-driven niche/city)
cd pipeline && npm run scrape:daily                    # daily scrape script (writes to DB — not the sheet pipeline)
cd pipeline && npm run outreach                        # send outreach (email + SMS)
cd pipeline && npm run outreach:dry                    # dry-run outreach (SMS_DRY_RUN=true)
cd pipeline && npm run outreach:t1                     # tier-1 only
cd pipeline && npm run repair                          # fix stuck/errored leads
cd pipeline && npm run api:deploy                      # deploy api/ Cloudflare Worker

# ─── Sheet scraping — 15 tabs, APPEND ONLY ───────────────────────────────────
# All 15 tabs use scrape-universal.ts. Never clears existing rows.
# Header: 22 columns (A–V)
#   A  Date Added       B  Business Name     C  Niche / Category  D  City
#   E  State / Country  F  Timezone          G  Phone             H  Email
#   I  Has Website      J  Website URL       K  Address           L  Rating
#   M  Reviews          N  GBP Claimed       O  Open Now          P  Price Level
#   Q  Tier             R  Maps URL
#   S  Business Email   T  Owner Email       U  Phone Type        V  Can SMS
#
# S/T populated by extractEmailsFromWebsite() — fetches site + /contact + /about pages
# U/V populated by lookupPhoneType() (libphonenumber-js/max, offline, free)
#   Phone Type values: mobile | landline | voip | toll-free | unknown
#   Can SMS: YES (mobile/voip/unknown) | NO (landline/toll-free)
#   US numbers always "unknown" due to number portability — SMS attempted anyway
#   outreach.ts + sms-agent.ts skip SMS when can_sms === false
#
# Spreadsheet: https://docs.google.com/spreadsheets/d/1wwZX7eriuA0i37t6_VOetkmHcS7YKiHXI2DYj7gfa9A
#
# ── LEAD TARGETS (100k per priority vertical) ─────────────────────────────────
# MEDSPAS          : 5 niches × 340 × 60 = 102k cap  → TARGET 100k  (currently ~9k)
# USA_Restaurants  : 5 niches × 340 × 60 = 102k cap  → TARGET 100k  (currently ~11k)
# USA_Financial    : 5 niches × 340 × 60 = 102k cap  → TARGET 100k  (currently ~1k)
# Local SMBs       : 7 niches × 340 × 60 = 142k cap  → TARGET 100k  (currently ~17k)
# TOTAL TARGET: 400k | ETA: ~28 days at 13k/day via scrape-fast.sh
#
# NICHE SLUGS (maps-scraper.ts NICHE_QUERY):
#   MEDSPAS     : medspa-usa, botox-clinic, aesthetic-clinic, cosmetic-dermatology, laser-clinic
#   Financial   : financial-advisor, insurance-agent, life-insurance, tax-advisor, mortgage-broker
#   Restaurants : restaurant, italian-restaurant, mexican-restaurant, asian-restaurant, bbq-steakhouse
#   Local SMBs  : hvac, roofing, plumbing, cleaning, landscaping, auto-detailing, remodeling
#
# ── S-TIER DAILY SCRAPE (scrape-fast.sh) ─────────────────────────────────────
# Run: cd pipeline && ./scrape-fast.sh 1000
# S-tier (2000/tab): MEDSPAS, SkinClinics, IVTherapy   → 6k/day
# A-tier (1000/tab): Salons, BarberShops, NailStudios, LocalSMBs → 4k/day
# B-tier (1000/tab): Dental, Restaurants, Financial     → 3k/day
# Total: ~13k/day | Scraping cost: $0 (Google Maps Playwright, no API)
#
# ── GCP CLOUD SCHEDULER (24/7 background scraping) ────────────────────────────
#   MEDSPAS              all hours  :00
#   INDIA_MEDSPAS        all hours  :30
#   USA_DentalOffices    all hours  :15
#   INDIA_DentalOffices  all hours  :15
#   USA_Salons           all hours  :45
#   USA_BarberShops      all hours  :45
#   USA_SkinClinics      all hours  :10
#   USA_IVTherapy        all hours  :50
#   USA_NailStudios      all hours  :20
#
# ── OTHER TABS ────────────────────────────────────────────────────────────────
#   Local SMBs           all hours  :00
#   USA_FinancialAdvisorsandInsuranceAgents  odd hours  :05
#   USA_RealEstateAgents                     even hours :05
#   USA_Restaurants                          odd hours  :35
#   India_Restaurants                        even hours :35
#   USA_LawFirms                             odd hours  :55
#
# Manual runs:
cd pipeline && SHEET_TAB="Local SMBs" npx tsx src/scripts/scrape-universal.ts
cd pipeline && SHEET_TAB="MEDSPAS" npx tsx src/scripts/scrape-universal.ts
cd pipeline && SHEET_TAB="USA_DentalOffices" npx tsx src/scripts/scrape-universal.ts
cd pipeline && SHEET_TAB="USA_LawFirms" npx tsx src/scripts/scrape-universal.ts
cd pipeline && SHEET_TAB="USA_SkinClinics" npx tsx src/scripts/scrape-universal.ts
cd pipeline && SHEET_TAB="USA_IVTherapy" npx tsx src/scripts/scrape-universal.ts
cd pipeline && SHEET_TAB="USA_NailStudios" npx tsx src/scripts/scrape-universal.ts
# (SHEET_TAB = any of the 15 tab names above)
cd pipeline && SCRAPE_TARGET=500 SHEET_TAB="MEDSPAS" npx tsx src/scripts/scrape-universal.ts  # bulk run

# Sheet management
cd pipeline && npx tsx src/scripts/init-all-headers.ts          # write 22-col header to all tabs (safe, skips if already correct)
cd pipeline && SHEET_TAB="MEDSPAS" ENRICH_LIMIT=500 npx tsx src/scripts/enrich-existing-rows.ts   # backfill email+phone cols for existing rows
cd pipeline && ENRICH_CONCUR=10 ENRICH_LIMIT=99999 npx tsx src/scripts/enrich-existing-rows.ts   # backfill all tabs
cd pipeline && npx tsx src/scripts/redistribute-leads.ts        # re-route Local SMBs rows to correct niche tabs (safe to re-run)
cd pipeline && npx tsx src/scripts/list-tabs.ts                 # list all tabs in spreadsheet
cd pipeline && npx tsx src/scripts/format-sheet.ts             # format "Local SMBs" tab
cd pipeline && npx tsx src/scripts/rebuild-sheet.ts --confirm   # DESTRUCTIVE: rebuild Local SMBs from DB (requires --confirm)

# Individual template dev servers
npm run dev:hvac
npm run dev:roofing
npm run dev:dentist
# ... dev:<niche> for any of the 25 niches

# Other apps
npm run dev:admin             # admin dashboard → http://localhost:3010
npm run dev:landing           # my-website → http://localhost:3001
npm run dev:webcrew           # webcrew → http://localhost:3002

# Cost tracking
npm run costs                 # last 30 days spend by service
npm run costs:total           # all-time totals
cd pipeline && npx tsx src/scripts/costs.ts --days 7  # last 7 days

# Demo site deployment (niche showcase sites on CF Pages)
# Triggered automatically on push to main via .github/workflows/deploy-niche-demos.yml
# HVAC: profix-hvac-demo.pages.dev (.github/workflows/deploy-hvac-demo.yml)
# All other niches: demo-<niche>.pages.dev (matrix workflow)
# Manual trigger: gh workflow run deploy-niche-demos.yml

# Domain management
npm run domain check jazzheating.com
npm run domain suggest "Jazz Heating & Air" "Tracy"
npm run domain connect "jazz heating" jazzheating.com
npm run domain list
npm run add-domain            # attach custom domain to deployed CF Pages project

# Image regeneration (when AI images need a redo)
npm run regen-images          # usage: add name-fragment and optional shot-index

# Template hero/project image generation (fal.ai Flux Pro)
cd pipeline && node --env-file=.env --import=tsx/esm src/scripts/gen-hero-grid-images.ts              # all niches
cd pipeline && node --env-file=.env --import=tsx/esm src/scripts/gen-hero-grid-images.ts <niche>       # one niche
cd pipeline && node --env-file=.env --import=tsx/esm src/scripts/gen-hero-grid-images.ts <niche> <file> # one file
# Each shot can override size: 'portrait_4_3' (default) | 'landscape_16_9' — use landscape for hero bg images

# Pipeline TypeScript check
cd pipeline && node_modules/.bin/tsc --noEmit

# Test DB connection
cd pipeline && npx tsx src/scripts/test-db.ts

# Apply DB migrations (idempotent — run in order)
psql $DATABASE_URL -f pipeline/src/db/migration-v2.sql
psql $DATABASE_URL -f pipeline/src/db/migration-v3-audits.sql
psql $DATABASE_URL -f pipeline/src/db/migration-v4.sql
psql $DATABASE_URL -f pipeline/src/db/migration-v5.sql
psql $DATABASE_URL -f pipeline/src/db/migration-v6-growth-os.sql
psql $DATABASE_URL -f pipeline/src/db/migration-v7-launch-foundation.sql
psql $DATABASE_URL -f pipeline/src/db/migration-v8-ads-foundation.sql     # ad_campaign_drafts table
psql $DATABASE_URL -f pipeline/src/db/migration-v9-compliance-launch.sql
psql $DATABASE_URL -f pipeline/src/db/migration-v11-gbp-per-client.sql
psql $DATABASE_URL -f pipeline/src/db/migration-v12-lead-events.sql

# AI Reception (Gemini Live — GCP Cloud Run, port 3030)
npm run reception              # start reception server locally
npm run reception:migrate      # apply reception_configs table to Neon DB (run once)
npm run reception:setup        # provision reception for a business: npx tsx src/scripts/setup-reception.ts <url>
npm run reception:list         # list all provisioned receptions

# Reception server deploy (GCP Cloud Run — gen-lang-client-0844283339)
# LIVE URL: https://ai-reception-571925663575.us-central1.run.app
# Redeploy after changes:
# 1. gcloud builds submit pipeline/ --tag us-central1-docker.pkg.dev/gen-lang-client-0844283339/webcrew/ai-reception:latest --project=gen-lang-client-0844283339
# 2. gcloud run deploy ai-reception --image=us-central1-docker.pkg.dev/gen-lang-client-0844283339/webcrew/ai-reception:latest --region=us-central1 --project=gen-lang-client-0844283339
# 3. Set Twilio phone webhook: POST https://ai-reception-571925663575.us-central1.run.app/voice/<configId>

# CF Worker env vars (for auto-provision on tier2 YES):
#   RECEPTION_SERVER_URL=https://ai-reception-571925663575.us-central1.run.app
#   RECEPTION_PROVISION_SECRET=wcreception-secret-2024

# Gemini Live model (bidiGenerateContent — confirmed working June 2026):
#   GEMINI_LIVE_MODEL=models/gemini-2.5-flash-native-audio-latest           # CURRENT DEFAULT — working
#   GEMINI_LIVE_MODEL=models/gemini-3.1-flash-live-preview                  # newer, untested
# WS endpoint: v1beta (NOT v1alpha). Old models removed: gemini-2.0-flash-live-001, gemini-2.5-flash-preview-native-audio-dialog
```

## Pipeline Architecture

`pipeline/src/orchestrator.ts` drives agents per lead, branching by tier:

**Tier 1 (no website) — full pipeline:**
```
lead-hunter    → Google Places API → tier1 (no website) + tier2 (has website) leads
brand-analyst  → Firecrawl scrape + Gemini → BrandData JSON (real photos, real reviews)
niche-brain    → Gemini → NicheProfile (unique visual style + cinematic prompts)
config-gen     → Gemini → TypeScript config.ts (real reviews as testimonials, niche copy)
image-gen      → real Google photos first; fal.ai Flux Pro fallback if < 4 real photos
video-gen      → Kling 1.6 Pro via fal.ai → 5s cinematic hero video
builder        → GitHub fork → writes config + uploads images + brand CSS injection
deployer       → Cloudflare Pages → polls until live
seo-agent      → sitemap.xml, robots.txt, schema JSON-LD
outreach       → Resend email + Twilio SMS: "here's your demo site — $299 one-time"
```

**Tier 2 (has website) — AI Reception outreach only:**
```
lead-hunter    → same as above
brand-analyst  → scrape for email/phone only
[everything else skipped]
outreach       → Resend email + Twilio SMS: "AI receptionist for [niche], test it: VAPI_DEMO_URL"
```

`Lead.status` full lifecycle:
`found → analyzed → config_generated → built → deployed → outreach_sent → sms_sent → conversation_active → meeting_scheduled → payment_link_sent → paid → handed_off`

Every step persists to Neon Postgres.

### Scale: Queue Worker (10-100 sites/day)

```bash
npm run worker:enqueue   # scan Google Maps + enqueue leads
npm run worker           # start N parallel workers (WORKER_CONCURRENCY=3)
npm run worker:status    # print queue depth
npm run worker:requeue   # retry stale leads
```

Uses `pg-boss` (Postgres-backed queue on Neon). `WORKER_CONCURRENCY` env controls parallelism.
Rate limits: Gemini 500 req/day free, fal.ai $0.04/img, Kling $0.05/video → ~$0.25/site total.

**Retention agents** (`pipeline/src/retention.ts`, run separately):
- `seo-agent` — generates sitemap.xml, robots.txt, schema JSON-LD, keyword list
- `gbp-agent` — posts weekly update to Google Business Profile via GMB API
- `reviews-agent` — fetches unanswered Google reviews, posts Gemini-generated replies
- `analytics-agent` — queries GSC for 28-day data, emails weekly summary to client
- `leads-agent` — handles contact form submissions → Neon + Google Sheets + Resend notify
- `video-agent` — Remotion 15s MP4 outreach video (install `@remotion/bundler @remotion/renderer remotion` first)

## packages/core (`@core/web`)

Shared library imported by every template. Never copy components between templates — extend core instead.

**Exports:**
```
@core/web            → sections + hooks + effects + types (barrel)
@core/web/sections   → Nav, Hero, HeroPhotoGrid, ScrollHero, Services, WhyUs,
                        Reviews, ServiceAreas, Contact, Footer, getIcon
@core/web/hooks      → useTextReveal, useEntranceReveal, useStaggerReveal,
                        useTilt, useParallax, useParticles, useScramble, useCounter
@core/web/types      → ThemeName, NicheName, Business, Service, Testimonial,
                        Stat, Reason, Property (all canonical config types)
@core/web/styles     → base CSS, tokens.css, utilities.css
```

**Hero variants:**
- `<Hero>` — cinematic full-bleed bg. Use `posterSrc="/hero-1.jpg"` for image bg, add `videoSrc` for video. Optional `posterBrightness` (0–1, default 0.45 — increase to 0.6–0.7 for portrait/people shots so subject is clearly visible). All niches now use this — no HeroPhotoGrid.
- `<ScrollHero>` — scroll-driven parallax hero (premium tier only)
- `<HeroPhotoGrid>` — deprecated for hero use. Do not use for new templates.

When adding a shared component, add to `packages/core/src/sections/` and export from `packages/core/src/sections/index.ts`.

## Template Architecture

Every template follows the same structure:
```
templates/<niche>/
  src/lib/config.ts          ← THE ONLY FILE that changes per client
  src/app/globals.css        ← @theme block with all CSS vars
  src/components/            ← nav, hero, services, why-us, reviews,
                                service-areas, contact, footer
  src/app/api/leads/route.ts ← POSTs to PIPELINE_API_URL/leads
```

**Design rules:**
- Tailwind v4 with `@theme {}` — ALL colors are CSS vars (`var(--color-*)`) never Tailwind color classes like `bg-green-500`
- GSAP only — no Framer Motion. Use `gsap.timeline()` for entrance sequences, `ScrollTrigger` for scroll-driven effects
- `EASE = [0.25, 0.46, 0.45, 0.94]` (or `"power3.out"`) everywhere for cinematic feel
- `next/link` is NOT used — plain `<a>` tags only
- Font weights `font-700`, `font-800`, `font-900` work as Tailwind utilities in v4

## Animation & UX Requirements (Draftly-standard)

Every template must implement ALL of the following. These are non-negotiable for award-winning feel.

### 1. Cinematic Loading Screen (`loading-screen.tsx`)
- Dark bg using `--brand-bg` gradient + aurora blobs
- Business name fades in → tagline fades in → progress bar fills → overlay slides up (yPercent: -100)
- Blocks body scroll (`overflow: hidden`) until complete
- Reference: `templates/hvac/src/components/loading-screen.tsx`

### 2. Scroll Progress Bar (`scroll-progress.tsx`)
- Fixed 2px bar at top of viewport
- Uses CSS var `--scroll-pct` driven by JS scroll listener
- Gradient: `--brand-accent` → `--brand-accent-light` with glow
- Reference: `templates/hvac/src/components/scroll-progress.tsx`

### 3. Lenis Smooth Inertia Scroll (`smooth-scroll.tsx`)
- `lerp: 0.1`, `smoothWheel: true`
- Must call `ScrollTrigger.update` on every Lenis scroll tick
- Already implemented — don't remove

### 4. GSAP Entrance Timelines (Hero)
Every hero must chain: label → badge → headline words → paragraph → CTAs → trust badges
```ts
const tl = gsap.timeline({ defaults: { ease: "power3.out" } })
tl.from(labelRef.current, { opacity: 0, y: -16, duration: 0.45 })
  .from(words, { yPercent: 110, opacity: 0, stagger: 0.045, duration: 0.75 }, "-=0.8")
  // ... continue chaining
```

### 5. Word-Split Headlines (ALL sections, not just hero)
Wrap headings in `<SplitText>` (word-wrap + word-inner pattern). Use `useTextReveal` hook:
```tsx
import { useTextReveal } from "@/hooks/use-text-reveal"
// in component:
useTextReveal(headingRef, { start: "top 85%" })
```
Reference: `templates/hvac/src/hooks/use-text-reveal.ts`

### 6. Multi-Layer Parallax (Hero)
Three speeds: background (yPercent: -25, scrub: 1.5), photo grid (yPercent: -15, scrub: 2), content fade (opacity → 0, scrub: 1)

### 7. Horizontal Pinned Scroll (Services)
Desktop only (matchMedia `min-width: 1024px`). Pin section, translate track by `-scrollWidth + vw`. Cards animate as they enter via `containerAnimation`. Mobile: standard vertical stagger.

### 8. GSAP quickTo 3D Tilt (Why-Us / Feature Cards)
```ts
const setRotX = gsap.quickTo(card, "rotationX", { duration: 0.4, ease: "power2.out" })
const setRotY = gsap.quickTo(card, "rotationY", { duration: 0.4, ease: "power2.out" })
gsap.set(card, { transformPerspective: 900, transformStyle: "preserve-3d" })
```
Dynamic box-shadow shifts with mouse position for depth illusion.

### 9. Staggered Card Entrances (ALL grid/card sections)
Use `useStaggerReveal` hook from `@/hooks/use-text-reveal`:
```tsx
useStaggerReveal(containerRef, ".service-card", { y: 48, scale: 0.95, stagger: 0.07 })
```

### 10. Particle Canvas (Hero background)
50 slow-moving dots, color from `--brand-particle` CSS var. Canvas resizes on window resize.

### 11. Aurora Blob Background (Hero + Loading Screen)
Two radial blobs using `--brand-blob-1` and `--brand-blob-2` with `filter: blur(80px)`. Animate with `@keyframes aurora-drift`.

### 12. Magnetic Cursor (`cursor.tsx`)
Custom cursor follows mouse with `lerp`. Already implemented — keep in all templates.

### 13. Premium Hover on ALL Interactive Elements
- Cards: `.hover-lift` class (translateY -6px + shadow on hover)
- Buttons: `.btn-primary` shimmer gradient animation (already in globals.css)
- Nav links: subtle accent underline slide-in
- Images: `scale(1.05)` on hover with `transition-transform duration-500`

### 14. Image Reveal Animation
Hero images and section images use `.img-reveal` wrapper. GSAP drives `clipPath: inset(0 100% 0 0)` → `inset(0 0% 0 0)` on scroll enter.

### 15. Scroll-Triggered Counter Animation (Stats)
Number counters animate from 0 to value when entering viewport. Use `gsap.to({ val: 0 }, { val: target, onUpdate: () => el.textContent = Math.round(obj.val) })`.

### 16. Section Entrance (every non-hero section)
All section headings/subheads use `useEntranceReveal` or `useTextReveal`. No section should just appear without animation.

---

### Animation Timing Reference
| Element | Duration | Ease | Delay |
|---------|----------|------|-------|
| Hero label | 0.45s | power3.out | 0 |
| Hero words | 0.75s | power3.out | stagger 0.045 |
| Hero para | 0.6s | power3.out | overlap |
| Section heading | 0.65s | power3.out | scroll |
| Cards stagger | 0.65s | power3.out | 0.07 per card |
| Loading bar | 1.1s | power2.inOut | after name |
| Loading exit | 0.75s | power4.inOut | after bar |
| 3D tilt | 0.4s | power2.out | mouse move |

**Hero layout options:** cinematic bg (videoSrc/posterSrc) vs photo grid (`<HeroPhotoGrid>` from `@core/web`). Photo grid is for interior/service-heavy niches (cleaning, dentist, medspa). All others use video bg.

## Niche Signature Sections (Phase 2)

Each niche has a custom section replacing the generic Services component. All use CSS vars — no hardcoded colors.

| Niche | Component | File |
|-------|-----------|------|
| medspa | `TreatmentMenuSection` | `templates/medspa/src/components/treatment-menu.tsx` |
| lawfirm | `PracticeAreasSection` + `AttorneySection` | `templates/lawfirm/src/components/` |
| dentist | `SmileGallerySection` | `templates/dentist/src/components/smile-gallery.tsx` |
| cleaning | `GuaranteeSection` | `templates/cleaning/src/components/guarantee-section.tsx` |
| roofing | `MaterialsSection` | `templates/roofing/src/components/materials-section.tsx` |
| remodeling | `ProjectGallerySection` | `templates/remodeling/src/components/project-gallery.tsx` |
| junk-removal | `ProcessSection` | `templates/junk-removal/src/components/process-section.tsx` |
| daycare | `CurriculumSection` | `templates/daycare/src/components/curriculum-section.tsx` |
| auto-detailing | `PackagesSection` | `templates/auto-detailing/src/components/packages-section.tsx` |
| hvac | `BrandStorySection` + `HeroThermostat` | already existed, no change |
| restaurant | custom sections | already existed, no change |
| luxury-realestate | custom sections | already existed, no change |
| skin-clinic | `SkinMenuSection` | `templates/skin-clinic/src/components/skin-menu.tsx` |
| iv-therapy | `DripMenuSection` | `templates/iv-therapy/src/components/drip-menu.tsx` |
| nail-studio | `NailMenuSection` | `templates/nail-studio/src/components/nail-menu.tsx` |

## Theme System

`packages/core/src/styles/tokens.css` defines all themes via CSS custom properties.

| Theme | Used by | Accent |
|-------|---------|--------|
| `clean` | all service templates + nail-studio (pink accent override) | indigo `#6366F1` |
| `slate` | medspa, skin-clinic (rose accent override `#E879A0`) | violet `#8B5CF6` |
| `dubai` | luxury-realestate | gold `#C9A96E` |
| `noir` | — (pipeline assigns to lawfirm) | white |
| `ocean` | dentist, iv-therapy | cyan `#06B6D4` |
| `forest` | — (pipeline assigns to daycare) | emerald |
| `ember` | — (pipeline assigns to restaurant) | amber |

Each template's `globals.css` sets `:root { --font-display: ...; --font-body: ...; }` to override the clean theme's Inter fallback with the niche-appropriate font (Playfair for lawfirm, Cormorant for medspa, Montserrat for roofing, etc.).

**config.ts exports:** `BUSINESS`, `SERVICES`, `TESTIMONIALS`, `TRUST_BADGES` — all template components read only from these.

When adding a new niche template, also update:
- `pipeline/src/types.ts` — add to `PipelineConfig.niche` union
- `pipeline/src/agents/builder.ts` — add to `NICHE_TEMPLATE_DIR`
- `pipeline/src/agents/config-generator.ts` — add fallback services
- `package.json` root — add `dev:<niche>` script

## New Modules (committed July 2026)

| Module | Path | Status |
|--------|------|--------|
| **Ads planner** | `pipeline/src/ads/` | Built, NOT wired to orchestrator. Needs `GOOGLE_ADS_CLIENT_ID` + `META_APP_ID` + admin approval UI |
| **Growth OS** | `pipeline/src/growth/` | Growth brain + DB layer for per-client growth plans |
| **Compliance** | `pipeline/src/compliance/` | TCPA/ad policy checker + `getLaunchReadiness()` — blocked on `PUBLIC_PRIVACY_URL` + `PUBLIC_TERMS_URL` env |
| **Cal.com booking** | `pipeline/src/reception/cal-booking.ts` | LIVE — `check_availability` + `book_appointment` tools in Gemini Live. Key: `CAL_DIY_API_KEY`. Event type: `CAL_EVENT_TYPE_ID` (default `6126925`) |
| **GCP auth** | `pipeline/src/tools/gcp-auth.ts` | Vertex AI JWT auth |
| **Gemini client** | `pipeline/src/tools/gemini.ts` | Vertex AI Gemini client (alternative to google-ai-studio) |
| **Sheets SMS outreach** | `pipeline/src/scripts/sheets-sms-outreach.ts` | SMS outreach directly from Google Sheets rows |

### TS Errors (5, non-fatal at runtime)
All in reception — `BusinessBrain | fallback` union not narrowed before passing to `buildSystemPrompt()` in `server.ts:286-287`, `setup-reception.ts:53-57`, and `FunctionDeclaration[]` mismatch in `gemini-live.ts:66`.
Fix: add `if (!brain || 'error' in brain) return fallbackBrain` guard before each call.

## Key Files

| File | Purpose |
|------|---------|
| `pipeline/src/types.ts` | `Lead`, `BrandData`, `PipelineConfig`, `AgentResult<T>` — all shared types |
| `pipeline/src/orchestrator.ts` | Main pipeline loop, sequential agent chaining |
| `pipeline/src/run.ts` | Entry point, reads env vars into `PipelineConfig` |
| `pipeline/src/retention.ts` | Retention loop — GBP, reviews, analytics for deployed clients |
| `pipeline/src/db/supabase.ts` | DB layer — uses `pg` + `DATABASE_URL` (Neon Postgres, not Supabase) |
| `pipeline/src/db/schema.sql` | DB schema — run once to initialize |
| `pipeline/src/db/migration-v2.sql` | Adds Places API v1 expanded fields + sales-funnel columns (idempotent) |
| `pipeline/src/tools/cost-tracker.ts` | `logCost()` — call from agents after paid API calls; query with `costs` script |
| `pipeline/src/tools/domain-registrar.ts` | Domain availability (RDAP) + CF Registrar integration + domain suggestions |
| `pipeline/src/tools/google-sheets.ts` | Sheets API — `appendSheetRow`, `clearSheet`, `writeSheetRows`, `listSheetTabs`, `batchUpdateSheet` |
| `pipeline/src/scripts/scrape-universal.ts` | **Master scraper** — all tabs, append-only, 22-column header. Runs email+phone enrichment per lead automatically. Use `SHEET_TAB=<tab>` env |
| `pipeline/src/scripts/enrich-existing-rows.ts` | Backfill email+phone cols for existing rows. Resume-safe. `SHEET_TAB`, `ENRICH_LIMIT`, `ENRICH_CONCUR` env |
| `pipeline/src/tools/email-extractor.ts` | Fetches website + /contact + /about, extracts business_email + owner_email via regex. 7s timeout, no API cost |
| `pipeline/src/tools/phone-lookup.ts` | Classifies phone as mobile/landline/voip/toll-free/unknown using libphonenumber-js/max (offline, free). Sets can_sms flag |
| `pipeline/src/scripts/rebuild-sheet.ts` | Rebuild "Local SMBs" from DB. **DESTRUCTIVE** — requires `--confirm` flag |
| `pipeline/src/scripts/list-tabs.ts` | List all tabs in the Google Spreadsheet |
| `pipeline/src/scripts/format-sheet.ts` | Apply professional formatting (header, widths, filters) to "Local SMBs" |
| `pipeline/src/scripts/regen-images.ts` | Regenerate fal.ai hero images for a lead by name fragment |
| `pipeline/src/scripts/add-domain.ts` | Attach custom domain to a deployed CF Pages project + update DB |
| `pipeline/src/scripts/domain.ts` | CLI for domain check / suggest / connect / list |
| `pipeline/src/scripts/costs.ts` | View spend by service (daily or all-time) |
| `pipeline/src/scripts/deps-tracker.ts` | Checks tracked deps via GitHub API |
| `packages/core/src/sections/index.ts` | Barrel — all shared section components |
| `packages/core/src/types/config.ts` | Canonical types: ThemeName, NicheName, Business, Service, etc. |
| `packages/core/src/hooks/index.ts` | Barrel — all animation hooks |
| `admin/src/app/page.tsx` | Dashboard home — reads live stats/leads/funnel from Neon |
| `admin/src/lib/db.ts` | Admin DB queries (read-only, no pg-boss) |
| `admin/src/lib/pool.ts` | CF Workers-compatible pg pool (no `pg` native bindings) |
| `admin/src/lib/edge-crypto.ts` | HMAC token signing for CF Workers (Web Crypto API) |
| `admin/Dockerfile` | Admin containerized deploy (for GCP Cloud Run if needed) |
| `admin/wrangler.toml` | Admin CF Worker deploy config |
| `api/src/index.ts` | CF Worker entry — contact form → Resend + Twilio + Google Sheets |
| `api/wrangler.toml` | Worker config — routes to api.webcrew.app |
| `pipeline/src/ads/planner.ts` | Generate Google/Meta/Instagram ad campaign drafts per lead |
| `pipeline/src/ads/store.ts` | Persist ad drafts to `ad_campaign_drafts` table |
| `pipeline/src/ads/export.ts` | Export drafts in platform-native API format |
| `pipeline/src/compliance/readiness.ts` | `getLaunchReadiness()` — full env/infra checklist |
| `pipeline/src/compliance/policy.ts` | TCPA/SMS/ad compliance policy checks |
| `pipeline/src/growth/brain.ts` | Growth plan generator (Gemini) |
| `pipeline/src/reception/cal-booking.ts` | Cal.com v2 — slot availability + booking creation |

## LLM

Pipeline uses **Gemini 2.5 Flash** (`@google/generative-ai`) — not Claude. Free tier: 1,500 req/day for brand extraction, 500 req/day for config generation. Key: `GOOGLE_AI_API_KEY`.

## Environment Variables

Required in `pipeline/.env` (see `pipeline/.env.example`):

```
GOOGLE_AI_API_KEY          # Gemini 2.5 Flash — brand analysis + config generation
GOOGLE_PLACES_API_KEY      # lead discovery + PageSpeed
FIRECRAWL_URL              # https://api.firecrawl.dev (cloud) or http://localhost:3002 (self-hosted)
FIRECRAWL_API_KEY          # firecrawl.dev API key, or "local" for self-hosted
GITHUB_TOKEN               # ranjeetsinghai79 classic PAT with repo scope
CLOUDFLARE_TOKEN           # API token with Pages:Edit permission
CLOUDFLARE_ACCOUNT_ID      # from dash.cloudflare.com → Workers & Pages sidebar
DATABASE_URL               # Neon Postgres connection string (neon.tech)
PIPELINE_API_URL           # hosted pipeline API URL (for contact form lead capture)
RESEND_API_KEY
OUTREACH_FROM_EMAIL        # e.g. hello@yourdomain.com
GOOGLE_SERVICE_ACCOUNT_FILE  # path to service account JSON file (used in this setup)
# OR: GOOGLE_SERVICE_ACCOUNT_JSON  # inline JSON blob (alternative to FILE)
GBP_ACCOUNT_ID / GBP_LOCATION_ID
LEADS_SHEET_ID
BUSINESS_OWNER_EMAIL

# Pipeline run config
NICHE=hvac                 # any of the 12 niche values
LOCATION=Tracy, CA
CITY=Tracy
STATE=CA
COUNT=10
DRY_RUN=true
TEMPLATE_OWNER=ranjeetsinghai79
TEMPLATE_REPO=websitedeveloper
DEPLOY_OWNER=ranjeetsinghai79
```

Deployed templates read `BUSINESS_NAME`, `BUSINESS_NICHE`, `PIPELINE_API_URL` from their Cloudflare Pages env.

## Google APIs Auth

Sheets, GMB (Google My Business), and GSC all use the same service account. Auth is JWT-based via `crypto.createSign('RSA-SHA256')` — no OAuth flow. Set `GOOGLE_SERVICE_ACCOUNT_FILE` to the path of the JSON key file from GCP Console → Service Accounts → Keys → JSON. Alternatively set `GOOGLE_SERVICE_ACCOUNT_JSON` to the inline JSON blob — the tools check `FILE` first, then `JSON`.

## Git Remotes

```
webcrew  → github.com/ranjeetsinghai79/webcrew           (PRIMARY deploy — push here first)
origin   → github.com/ranjeetsinghai79/websitedeveloper  (legacy backup)
pavan    → github.com/pavankumarharati/websitedeveloper   (personal backup)
```

Push: `git push webcrew main && git push origin main && git push pavan main`

## webcrew/ — Marketing Site (webcrew.app)

Separate git repo at `webcrew/` (gitignored by monorepo root `.gitignore`).
Remotes: `deploy` → ranjeetsinghai79/webcrew (CF Pages auto-deploy), `origin` → pavankumarharati/webcrew.
Push: `git -C webcrew push deploy main` (only `deploy` remote works with ranjeet's token).

**Design system:** Electric blue + purple (`#2563EB → #7C3AED`). No dark theme. Bright/light background.
Font: Plus Jakarta Sans (display) + Inter (body).
Palette tokens: `--color-blue`, `--color-purple`, `--color-indigo`, `--color-bg`, `--color-surface`.
Class: `.gradient-brand` = blue→purple gradient text.

**Pricing model (single source of truth):**
- FREE demo site built overnight (Tier 1 — no website)
- $299 one-time — pay only if you love it (site ownership)
- $49/mo — AI team: AI call answering (Gemini Live), GBP posts, review replies, GSC weekly report, lead SMS alerts
- Custom — multi-location, e-commerce, booking, CRM integrations

**Outreach strategy:**
- Tier 1 (no website) SMS: "We built your {niche} business in {city} a FREE website overnight. See it → webcrew.app Pay $299 only if you love it."
- Tier 2 (has website) SMS: "AI receptionist for {niche} in {city} — answers calls 24/7, $49/mo. Try free → webcrew.app"
- Outreach channel: SMS ONLY (Twilio 10DLC, $0.0079/SMS). AI Reception = inbound product, NOT outbound call tool.
- CTA destination: webcrew.app → contact form → books call or triggers pipeline
- Cal.com booking: integrated in AI Reception (check_availability + book_appointment via CAL_DIY_API_KEY)
- Batch: start 200/day, ramp to 1000/day (Week 2), max 3600/day (10DLC standard limit)

**Contact form flows:**
- Tab 1 "No Website" → `POST https://api.webcrew.app/leads` → Tier 1 pipeline
- Tab 2 "Upgrade My Site" → same endpoint with `flowType: 'upgrade'` + currentUrl
- Tab 3 "Free Audit" → `POST https://api.webcrew.app/audit` → Firecrawl + PageSpeed + Gemini → HTML report email in 5 min
  - Phone is REQUIRED (mandatory) on audit form
  - Audit consent includes SMS opt-in for follow-up

**Twilio 10DLC compliance (A2P):**
- Consent model: inbound-only — users opt in via website form checkbox
- Consent copy: "I agree to receive text messages from WebCrew regarding my website demo... Consent is not a condition of purchase."
- Privacy policy at `/privacy`: includes exact carrier clause — "No mobile information will be shared with third parties/affiliates for marketing/promotional purposes..."
- SMS section states explicitly: "We do not engage in unsolicited cold texting."
- `webcrew/src/app/privacy/page.tsx` — carrier clause in Data Sharing section

**SEO/AEO/VSO (layout.tsx):**
- JSON-LD: FAQPage (6 Q&As), HowTo (3 steps), Organization, Service schemas
- Title targets: "AI builds your local business website overnight free"
- HowTo schema for voice search: 3-step process (sign up → AI builds → wake up to leads)
- FAQPage for AEO: answers ChatGPT/Perplexity/Claude queries about WebCrew pricing, speed, niches

**Dev:** `npm run dev:webcrew` → `http://localhost:3002`
**Deploy:** push to `deploy` remote triggers CF Pages build (Next.js static export)

## Business Brain (Firecrawl per-business LLM context)

`pipeline/src/tools/firecrawl.ts` exports `crawlBusinessSite(url, opts) → BusinessBrain`

BusinessBrain is the persistent LLM context for each client. Powers:
- **audit-report**: PageSpeed + Firecrawl + Gemini → HTML grade report (attached to outreach email)
- **brand-analyst**: extract services, pricing, team, colors, testimonials, USPs
- **config-generator**: hyper-personalized config.ts with real business data
- **image-generator**: use brain.media.gallery_images + hero_images from existing site
- **ai-reception**: knowledge base (services, hours, pricing, FAQs) for the AI receptionist
- **blog-generator** (retention): Gemini uses brain.full_text to write SEO posts in client's voice
- **ai-growth**: GBP posts written using real business context from brain

Media extraction from brain:
- `brain.media.images` — all image URLs across site
- `brain.media.hero_images` — og:image + above-fold images
- `brain.media.gallery_images` — portfolio/work photos
- `brain.media.before_after` — [{before, after, caption}] pairs
- `brain.media.youtube_embeds` — YouTube video IDs
- `brain.media.video_testimonials` — videos near review/testimonial context
- `brain.media.logo_url` — business logo

Brain is persisted to `leads.business_brain` (JSONB) in Neon DB.

## GCP Infrastructure

All services on `gen-lang-client-0844283339` / `us-central1`:
- `ai-reception` — Gemini Live + Twilio Media Streams (live)
- `firecrawl` — self-hosted Firecrawl API + Redis sidecar (deployed via `pipeline/firecrawl/`)
- Scraper Cloud Run Jobs — 12 jobs, triggered by Cloud Scheduler (see `pipeline/deploy-gcp.sh`)

Firecrawl URL after deploy: set `FIRECRAWL_URL` to Cloud Run service URL
Deploy Firecrawl: `bash pipeline/deploy-gcp.sh`
Deploy scraper jobs: same script (section 4)

## Firecrawl

Cloud API only: `FIRECRAWL_URL=https://api.firecrawl.dev` + `FIRECRAWL_API_KEY` (free 500 scrapes/month at firecrawl.dev). Used only by `brand-analyst` agent — falls back to Google Places data if unavailable.

## Active Claude Skills (invoke before web design work)

These skills are pre-installed in the Claude Code environment. Invoke via `/skill-name`.

| When | Skill | Why |
|------|-------|-----|
| Any template design decision | `/ui-ux-pro-max` | spacing systems, visual hierarchy, premium UX patterns |
| GSAP / Lenis / animation work | `/animation-libraries` | entrance timelines, scroll effects, micro-interactions |
| New niche theme / color system | `/brand-guidelines` | color tokens, font pairing, visual language consistency |
| Canvas FX / particle systems / WebGL | `/canvas-design` | aurora blobs, particle canvas, shader effects |
| Before any CF Pages / GCP deploy | `/web-perf` | LCP < 2s, zero CLS, composited-only animations |
| Frontend component implementation | `/frontend-design` | pixel-perfect CSS, token systems, Tailwind v4 patterns |
| Contact forms / API routes / auth | `/owasp-security` | XSS, CSRF, injection — $20k clients require this |
| Post-build QA of interactions | `/webapp-testing` | test every hover, scroll trigger, mobile breakpoint |

## Luxury Design Quality Gates ($20k Standard)

Every template must pass ALL before merge/deploy:

### Visual
- [ ] Cinematic loading screen with progress bar — dark bg, brand aurora blobs, name → tagline → bar → overlay exit
- [ ] Custom magnetic cursor (`cursor.tsx`) — context-aware, follows with lerp
- [ ] Zero hardcoded colors — CSS vars only (`var(--color-*)`, never `bg-green-500`)
- [ ] Word-split reveals on ALL headings (not just hero) — `useTextReveal` hook
- [ ] Scroll progress bar — fixed 2px top, gradient accent with glow

### Animation
- [ ] Hero entrance timeline chains: label → badge → headline words → paragraph → CTAs → trust badges
- [ ] 3D tilt on feature/why-us cards — `gsap.quickTo` rotationX/Y + dynamic shadow
- [ ] Horizontal pinned scroll on Services (desktop ≥1024px) — mobile vertical stagger
- [ ] Image reveals — `clipPath: inset(0 100% 0 0)` → `inset(0 0%)` on scroll enter
- [ ] Stats counters animate 0 → value on viewport enter
- [ ] All card grids use `useStaggerReveal` — no section appears without animation

### Performance
- [ ] LCP ≤ 2.5s (measure with PageSpeed or Lighthouse)
- [ ] CLS = 0 — no layout shift on font load or image load
- [ ] `will-change: transform` on animated elements, removed after animation completes
- [ ] Hero images use `next/image` with `priority` + correct `sizes`
- [ ] Lenis + ScrollTrigger wired: `ScrollTrigger.update` called on every Lenis tick

### Mobile
- [ ] Horizontal scroll section degrades to vertical stagger on mobile
- [ ] Custom cursor hidden on touch devices
- [ ] Loading screen exit ≤ 1.5s on 3G (don't block on heavy assets)
- [ ] All GSAP `matchMedia` guards in place for desktop-only effects

## npm Packages for $20k Luxury Feel

Already in stack: `gsap`, `@studio-freight/lenis`. Add if needed:

```bash
# WebGL / 3D backgrounds (luxury real estate, medspa, skin-clinic)
npm install three @types/three
npm install @react-three/fiber @react-three/drei

# Noise texture shaders (organic luxury feel)
npm install glsl-noise

# Premium icon set (beyond lucide — for luxury niches)
npm install @phosphor-icons/react
```

Three.js is optional — use only for `luxury-realestate`, `medspa`, `skin-clinic` where WebGL hero adds value. All other niches: canvas particle system sufficient.
