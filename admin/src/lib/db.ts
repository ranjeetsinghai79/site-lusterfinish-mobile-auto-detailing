import { Pool } from "@/lib/pool"

// Lazy pool — CF Workers injects process.env only at request time, not module load
let _pool: Pool | null = null
function pool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

// ── Lead ─────────────────────────────────────────────────────────────────────

export interface Lead {
  id: string
  name: string
  niche: string
  city: string
  state: string
  phone?: string
  email?: string
  website?: string
  tier?: string
  client_plan?: string
  status: string
  site_score?: number
  cloudflare_url?: string
  vercel_url?: string
  github_repo?: string
  rating?: number
  review_count?: number
  paid?: boolean
  stripe_payment_link?: string
  location_group_id?: string
  vapi_assistant_id?: string
  vapi_phone_number?: string
  webhook_url?: string
  created_at?: string
  // call tracking
  last_call_at?: string
  call_status?: string
  call_sid?: string
  call_count?: number
  sms_opt_out?: boolean
}

export async function getLeads(): Promise<Lead[]> {
  const { rows } = await pool().query<Lead>(`
    SELECT id, name, niche, city, state, phone, email, website,
           tier, status, site_score, cloudflare_url, vercel_url,
           github_repo, rating, review_count, paid, created_at,
           last_call_at, call_status, call_count, sms_opt_out
    FROM leads
    ORDER BY created_at DESC
    LIMIT 500
  `)
  return rows
}

export async function updateCallTracking(
  id: string,
  callSid: string,
  status: string,
): Promise<void> {
  await pool().query(
    `UPDATE leads
     SET call_sid = $2, call_status = $3, last_call_at = NOW(),
         call_count = COALESCE(call_count, 0) + 1
     WHERE id = $1`,
    [id, callSid, status],
  )
}

export async function setCallStatus(id: string, status: string): Promise<void> {
  await pool().query(`UPDATE leads SET call_status = $2 WHERE id = $1`, [id, status])
}

export async function setOptOut(id: string): Promise<void> {
  await pool().query(
    `UPDATE leads SET sms_opt_out = true, call_status = 'opted_out' WHERE id = $1`,
    [id],
  )
}

export async function getRecentLeads(limit = 8): Promise<Lead[]> {
  const { rows } = await pool().query<Lead>(
    `SELECT id, name, niche, city, state, status, tier, cloudflare_url, vercel_url, created_at
     FROM leads ORDER BY created_at DESC LIMIT $1`,
    [limit]
  )
  return rows
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface FullStats {
  total:      number
  processing: number
  deployed:   number
  paid:       number
  errors:     number
  skipped:    number
}

export async function getFullStats(): Promise<FullStats> {
  const { rows } = await pool().query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status IN ('found','scored','analyzed','config_generated','built')) AS processing,
      COUNT(*) FILTER (WHERE status IN ('deployed','outreach_sent','sms_sent','conversation_active','meeting_scheduled','payment_link_sent')) AS deployed,
      COUNT(*) FILTER (WHERE paid = TRUE OR status IN ('paid','handed_off')) AS paid,
      COUNT(*) FILTER (WHERE status = 'error') AS errors,
      COUNT(*) FILTER (WHERE status = 'skipped') AS skipped
    FROM leads
  `)
  const r = rows[0]
  return {
    total:      Number(r.total),
    processing: Number(r.processing),
    deployed:   Number(r.deployed),
    paid:       Number(r.paid),
    errors:     Number(r.errors),
    skipped:    Number(r.skipped),
  }
}

// Legacy compat
export async function getStats() {
  const s = await getFullStats()
  return { total: s.total, deployed: s.deployed, paid: s.paid, errors: s.errors }
}

export interface FunnelStage { group: string; count: number; color: string }

const FUNNEL_ORDER = ["Processing", "Live", "Engaged", "Converted", "Skipped", "Error"]

export async function getFunnelData(): Promise<FunnelStage[]> {
  const { rows } = await pool().query(`
    SELECT
      CASE
        WHEN status IN ('found','scored','analyzed','config_generated','built') THEN 'Processing'
        WHEN status IN ('deployed','outreach_sent','sms_sent') THEN 'Live'
        WHEN status IN ('conversation_active','meeting_scheduled','payment_link_sent') THEN 'Engaged'
        WHEN status IN ('paid','handed_off') THEN 'Converted'
        WHEN status = 'skipped' THEN 'Skipped'
        ELSE 'Error'
      END AS grp,
      COUNT(*) AS count
    FROM leads
    GROUP BY grp
  `)
  const colors: Record<string, string> = {
    Processing: "#6366f1",
    Live:       "#10b981",
    Engaged:    "#3b82f6",
    Converted:  "#22c55e",
    Skipped:    "#475569",
    Error:      "#ef4444",
  }
  const map = Object.fromEntries(rows.map(r => [r.grp, Number(r.count)]))
  return FUNNEL_ORDER.map(g => ({ group: g, count: map[g] ?? 0, color: colors[g] }))
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function setLeadTier(id: string, tier: string): Promise<void> {
  await pool().query(`UPDATE leads SET tier=$1 WHERE id=$2`, [tier, id])
}

export async function setLeadStatus(id: string, status: string): Promise<void> {
  await pool().query(`UPDATE leads SET status=$1 WHERE id=$2`, [status, id])
}

export async function markLeadPaid(id: string): Promise<void> {
  await pool().query(
    `UPDATE leads SET paid=TRUE, status='handed_off' WHERE id=$1`,
    [id]
  )
}

export async function deleteLead(id: string): Promise<void> {
  await pool().query(`DELETE FROM leads WHERE id=$1`, [id])
}

export async function setLeadEmail(id: string, email: string): Promise<void> {
  await pool().query(`UPDATE leads SET email=$1 WHERE id=$2`, [email || null, id])
}

export async function getCallLeads(): Promise<Lead[]> {
  const { rows } = await pool().query<Lead>(`
    SELECT id, name, niche, city, state, phone, email, website,
           tier, status, rating, review_count, cloudflare_url, vercel_url, created_at
    FROM leads
    WHERE phone IS NOT NULL
      AND status IN ('found','scored','called','interested')
    ORDER BY
      CASE WHEN status = 'interested' THEN 0
           WHEN status = 'called' THEN 2
           ELSE 1
      END,
      (website IS NULL) DESC,
      rating DESC NULLS LAST,
      created_at DESC
    LIMIT 200
  `)
  return rows
}

export interface SurveyResponse {
  id: string
  created_at: string
  name: string | null
  biz: string | null
  phone: string | null
  niche: string | null
  pain: string | null
  has_website: string | null
  ai_want: string | null
  budget: string | null
}

export async function getSurveyResponses(): Promise<SurveyResponse[]> {
  try {
    const { rows } = await pool().query<SurveyResponse>(`
      SELECT id, created_at, name, biz, phone, niche, pain, has_website, ai_want, budget
      FROM survey_responses
      ORDER BY created_at DESC
      LIMIT 500
    `)
    return rows
  } catch {
    return []
  }
}

export interface BusinessManagerSummary {
  workspace_id: string
  business_name: string
  website_url: string
  industry: string | null
  city: string | null
  autonomy_level: number
  plan_id: string | null
  plan_summary: string | null
  plan_priority: string | null
  queued_tasks: number
  approval_tasks: number
  memory_chunks: number
  social_drafts: number
  ad_drafts: number
  crm_events: number
  updated_at: string
}

export async function getBusinessManagerSummaries(): Promise<BusinessManagerSummary[]> {
  try {
    const { rows } = await pool().query<BusinessManagerSummary>(`
      SELECT
        gw.id AS workspace_id,
        gw.business_name,
        gw.website_url,
        gw.industry,
        gw.city,
        gw.autonomy_level,
        gp.id AS plan_id,
        gp.summary AS plan_summary,
        gp.priority AS plan_priority,
        COUNT(DISTINCT gat.id) FILTER (WHERE gat.status = 'queued') AS queued_tasks,
        COUNT(DISTINCT gat.id) FILTER (WHERE gat.status = 'needs_approval') AS approval_tasks,
        COUNT(DISTINCT mc.id) AS memory_chunks,
        COUNT(DISTINCT sa.id) FILTER (WHERE sa.status IN ('draft','needs_approval')) AS social_drafts,
        COUNT(DISTINCT acd.id) FILTER (WHERE acd.status IN ('draft','needs_approval')) AS ad_drafts,
        COUNT(DISTINCT cse.id) AS crm_events,
        gw.updated_at::text
      FROM growth_workspaces gw
      LEFT JOIN growth_plans gp ON gp.id = gw.current_plan_id
      LEFT JOIN growth_agent_tasks gat ON gat.workspace_id = gw.id
      LEFT JOIN memory_chunks mc ON mc.workspace_id = gw.id
      LEFT JOIN social_assets sa ON sa.workspace_id = gw.id
      LEFT JOIN ad_campaign_drafts acd ON acd.workspace_id = gw.id
      LEFT JOIN crm_sync_events cse ON cse.workspace_id = gw.id
      GROUP BY gw.id, gp.id
      ORDER BY gw.updated_at DESC
      LIMIT 100
    `)
    return rows.map((row) => ({
      ...row,
      queued_tasks: Number(row.queued_tasks),
      approval_tasks: Number(row.approval_tasks),
      memory_chunks: Number(row.memory_chunks),
      social_drafts: Number(row.social_drafts),
      ad_drafts: Number(row.ad_drafts),
      crm_events: Number(row.crm_events),
    }))
  } catch {
    return []
  }
}

export interface FrontOfficeActivity {
  kind: "task" | "social" | "ad" | "crm"
  workspace_id: string
  business_name: string
  title: string
  status: string
  priority: string | null
  created_at: string
}

export async function getFrontOfficeActivity(): Promise<FrontOfficeActivity[]> {
  try {
    const { rows } = await pool().query<FrontOfficeActivity>(`
      SELECT * FROM (
        SELECT 'task' AS kind, gw.id AS workspace_id, gw.business_name,
               gat.title, gat.status, gat.priority, gat.created_at::text
        FROM growth_agent_tasks gat
        JOIN growth_workspaces gw ON gw.id = gat.workspace_id
        UNION ALL
        SELECT 'social' AS kind, gw.id AS workspace_id, gw.business_name,
               sa.title, sa.status, NULL AS priority, sa.created_at::text
        FROM social_assets sa
        JOIN growth_workspaces gw ON gw.id = sa.workspace_id
        UNION ALL
        SELECT 'ad' AS kind, gw.id AS workspace_id, gw.business_name,
               acd.campaign_name AS title, acd.status, NULL AS priority, acd.created_at::text
        FROM ad_campaign_drafts acd
        JOIN growth_workspaces gw ON gw.id = acd.workspace_id
        UNION ALL
        SELECT 'crm' AS kind, gw.id AS workspace_id, gw.business_name,
               cse.event_type AS title, cse.status, NULL AS priority, cse.created_at::text
        FROM crm_sync_events cse
        JOIN growth_workspaces gw ON gw.id = cse.workspace_id
      ) x
      ORDER BY created_at DESC
      LIMIT 80
    `)
    return rows
  } catch {
    return []
  }
}

export interface PendingApproval {
  entity_type: "task" | "social" | "ad"
  entity_id: string
  workspace_id: string
  business_name: string
  title: string
  status: string
  detail: string | null
  compliance_warnings: string[]
  created_at: string
}

export async function getPendingApprovals(): Promise<PendingApproval[]> {
  try {
    const { rows } = await pool().query<PendingApproval>(`
      SELECT * FROM (
        SELECT 'task' AS entity_type, gat.id AS entity_id, gw.id AS workspace_id, gw.business_name,
               gat.title, gat.status, gat.priority AS detail,
               '[]'::jsonb AS compliance_warnings, gat.created_at::text
        FROM growth_agent_tasks gat
        JOIN growth_workspaces gw ON gw.id = gat.workspace_id
        WHERE gat.status = 'needs_approval'
        UNION ALL
        SELECT 'social' AS entity_type, sa.id::text AS entity_id, gw.id AS workspace_id, gw.business_name,
               sa.title, sa.status, sa.platform AS detail,
               sa.compliance_warnings, sa.created_at::text
        FROM social_assets sa
        JOIN growth_workspaces gw ON gw.id = sa.workspace_id
        WHERE sa.status = 'needs_approval'
        UNION ALL
        SELECT 'ad' AS entity_type, acd.id::text AS entity_id, gw.id AS workspace_id, gw.business_name,
               acd.campaign_name AS title, acd.status, acd.platform || ' · $' || acd.daily_budget::text || '/day' AS detail,
               acd.compliance_warnings, acd.created_at::text
        FROM ad_campaign_drafts acd
        JOIN growth_workspaces gw ON gw.id = acd.workspace_id
        WHERE acd.status = 'needs_approval'
      ) x
      ORDER BY created_at DESC
      LIMIT 100
    `)
    return rows.map((row) => ({
      ...row,
      compliance_warnings: row.compliance_warnings ?? [],
    }))
  } catch {
    return []
  }
}

export interface IntegrationStatus {
  provider: string
  status: string
  account_label: string | null
  connected_at: string | null
}

export async function getIntegrationStatuses(): Promise<IntegrationStatus[]> {
  const required = ["google_ads", "meta_ads", "instagram_ads"]
  try {
    const { rows } = await pool().query<IntegrationStatus>(`
      SELECT provider, status, account_label, connected_at::text
      FROM integration_connections
      WHERE provider = ANY($1::text[])
    `, [required])
    const byProvider = new Map(rows.map((row) => [row.provider, row]))
    return required.map((provider) => byProvider.get(provider) ?? {
      provider,
      status: "not_connected",
      account_label: null,
      connected_at: null,
    })
  } catch {
    return required.map((provider) => ({
      provider,
      status: "not_connected",
      account_label: null,
      connected_at: null,
    }))
  }
}

export async function resetLeadForRebuild(id: string): Promise<void> {
  await pool().query(
    `UPDATE leads SET status='analyzed', github_repo=NULL, cloudflare_url=NULL,
     vercel_url=NULL, outreach_sent=NULL, sms_sent=NULL WHERE id=$1`,
    [id]
  )
}

export async function getLeadById(id: string): Promise<{ status: string; cloudflare_url?: string } | null> {
  const { rows } = await pool().query(
    `SELECT status, cloudflare_url FROM leads WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

// ── Client auth ───────────────────────────────────────────────────────────────

export async function createMagicToken(email: string): Promise<string> {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  const token = Array.from(arr, b => b.toString(16).padStart(2, "0")).join("")
  await pool().query(
    `INSERT INTO client_tokens (email, token) VALUES ($1, $2)`,
    [email, token]
  )
  return token
}

export async function validateMagicToken(token: string): Promise<string | null> {
  const { rows } = await pool().query(
    `UPDATE client_tokens
     SET used = TRUE
     WHERE token = $1 AND used = FALSE AND expires_at > NOW()
     RETURNING email`,
    [token]
  )
  return rows[0]?.email ?? null
}

export async function getClientLead(email: string): Promise<Lead | null> {
  const { rows } = await pool().query<Lead>(
    `SELECT id, name, niche, city, state, phone, email, website, tier, client_plan,
            status, site_score, cloudflare_url, vercel_url, github_repo,
            rating, review_count, paid, location_group_id, vapi_assistant_id,
            vapi_phone_number, webhook_url, created_at
     FROM leads WHERE email = $1 ORDER BY created_at DESC LIMIT 1`,
    [email]
  )
  return rows[0] ?? null
}

// ── Multi-location (Scale) ─────────────────────────────────────────────────────

export async function getLocationGroup(groupId: string): Promise<Lead[]> {
  const { rows } = await pool().query<Lead>(
    `SELECT id, name, niche, city, state, phone, email, website, tier, client_plan,
            status, site_score, cloudflare_url, vercel_url, rating, review_count,
            paid, location_group_id, vapi_phone_number, created_at
     FROM leads WHERE location_group_id = $1 ORDER BY created_at ASC`,
    [groupId]
  )
  return rows
}

export async function getClientLocations(email: string): Promise<Lead[]> {
  // First find the primary lead
  const primary = await getClientLead(email)
  if (!primary) return []
  // If in a group, return all group members; otherwise just the one
  if (primary.location_group_id) {
    return getLocationGroup(primary.location_group_id)
  }
  return [primary]
}

export async function setLocationGroup(leadIds: string[], groupId: string): Promise<void> {
  await pool().query(
    `UPDATE leads SET location_group_id=$1 WHERE id = ANY($2::uuid[])`,
    [groupId, leadIds]
  )
}

// ── getDb: pool accessor for API routes ───────────────────────────────────────

export async function getDb() {
  return pool()
}

// ── Lead activity timeline ──────────────────────────────────────────────────

export interface LeadEvent {
  id: string
  event_type: string
  detail: any
  created_at: string
}

export async function getLeadEvents(leadId: string): Promise<LeadEvent[]> {
  const { rows } = await pool().query<LeadEvent>(
    `SELECT id, event_type, detail, created_at FROM lead_events WHERE lead_id=$1 ORDER BY created_at DESC`,
    [leadId]
  )
  return rows
}

export async function logLeadEventByEmail(
  email: string,
  eventType: string,
  detail?: Record<string, unknown>
): Promise<void> {
  const { rows } = await pool().query(`SELECT id FROM leads WHERE email=$1 LIMIT 1`, [email])
  const leadId = rows[0]?.id
  if (!leadId) return
  await pool().query(
    `INSERT INTO lead_events (lead_id, event_type, detail) VALUES ($1, $2, $3)`,
    [leadId, eventType, detail ? JSON.stringify(detail) : null]
  )
}

export async function logLeadEventByPhone(
  phone: string,
  eventType: string,
  detail?: Record<string, unknown>
): Promise<string | null> {
  const normalized = phone.replace(/\D/g, '')
  const { rows } = await pool().query(
    `SELECT id FROM leads WHERE regexp_replace(phone, '\\D', '', 'g') = $1 LIMIT 1`,
    [normalized]
  )
  const leadId = rows[0]?.id
  if (!leadId) return null
  await pool().query(
    `INSERT INTO lead_events (lead_id, event_type, detail) VALUES ($1, $2, $3)`,
    [leadId, eventType, detail ? JSON.stringify(detail) : null]
  )
  return leadId
}
