import pg from 'pg'
import type { ReceptionConfig, BusinessBrain } from './types.js'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

export async function saveReceptionConfig(
  websiteUrl: string,
  businessName: string,
  brain: BusinessBrain,
  systemPrompt: string,
  leadId?: string
): Promise<ReceptionConfig> {
  const { rows } = await pool.query(
    `INSERT INTO reception_configs (website_url, business_name, brain_json, system_prompt, lead_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (website_url) DO UPDATE SET
       business_name  = EXCLUDED.business_name,
       brain_json     = EXCLUDED.brain_json,
       system_prompt  = EXCLUDED.system_prompt,
       updated_at     = NOW()
     RETURNING *`,
    [websiteUrl, businessName, JSON.stringify(brain), systemPrompt, leadId ?? null]
  )
  return rowToConfig(rows[0])
}

export async function getReceptionConfig(websiteUrl: string): Promise<ReceptionConfig | null> {
  const { rows } = await pool.query(
    `SELECT * FROM reception_configs WHERE website_url = $1 AND active = true LIMIT 1`,
    [websiteUrl]
  )
  return rows[0] ? rowToConfig(rows[0]) : null
}

export async function getReceptionConfigById(id: string): Promise<ReceptionConfig | null> {
  const { rows } = await pool.query(
    `SELECT * FROM reception_configs WHERE id = $1 LIMIT 1`,
    [id]
  )
  return rows[0] ? rowToConfig(rows[0]) : null
}

export async function listReceptionConfigs(): Promise<ReceptionConfig[]> {
  const { rows } = await pool.query(
    `SELECT * FROM reception_configs ORDER BY created_at DESC`
  )
  return rows.map(rowToConfig)
}

export async function updateTwilioPhone(id: string, phone: string): Promise<void> {
  await pool.query(
    `UPDATE reception_configs SET twilio_phone = $2, updated_at = NOW() WHERE id = $1`,
    [id, phone]
  )
}

export async function insertCallLog(opts: {
  configId:    string
  leadId?:     string
  caller:      string | null
  durationSec: number
  transcript:  string
  escalated:   boolean
  message?:    string
}): Promise<void> {
  await pool.query(
    `INSERT INTO call_logs
       (reception_config_id, lead_id, caller_number, duration_seconds, transcript, escalated, message_taken)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [opts.configId, opts.leadId ?? null, opts.caller, opts.durationSec, opts.transcript, opts.escalated, opts.message ?? null]
  )

  if (!opts.leadId) return
  const booked = opts.transcript.includes('[BOOKING]')
  try {
    await pool.query(
      `INSERT INTO lead_events (lead_id, event_type, detail) VALUES ($1, $2, $3)`,
      [opts.leadId, 'call_received', JSON.stringify({ caller: opts.caller, durationSec: opts.durationSec })]
    )
    if (booked) {
      await pool.query(
        `INSERT INTO lead_events (lead_id, event_type, detail) VALUES ($1, $2, $3)`,
        [opts.leadId, 'call_booked', JSON.stringify({ caller: opts.caller })]
      )
    }
    if (opts.escalated) {
      await pool.query(
        `INSERT INTO lead_events (lead_id, event_type, detail) VALUES ($1, $2, $3)`,
        [opts.leadId, 'call_escalated', JSON.stringify({ caller: opts.caller })]
      )
    }
  } catch (e: any) {
    console.error('[DB] lead_events insert failed:', e.message)
  }
}

function rowToConfig(row: any): ReceptionConfig {
  return {
    id:            row.id,
    lead_id:       row.lead_id,
    website_url:   row.website_url,
    business_name: row.business_name,
    brain:         row.brain_json,
    system_prompt: row.system_prompt,
    twilio_phone:  row.twilio_phone,
    active:        row.active,
    created_at:    row.created_at,
  }
}
