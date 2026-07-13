export const runtime = 'edge'
import { NextRequest, NextResponse } from "next/server"
import { Pool } from "@/lib/pool"

let _pool: InstanceType<typeof Pool> | null = null
function pool(): InstanceType<typeof Pool> {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return _pool
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params
  const url = new URL(req.url)
  const state = url.searchParams.get("state")
  const code = url.searchParams.get("code")
  const error = url.searchParams.get("error")

  if (error) return NextResponse.redirect(new URL(`/integrations?error=${encodeURIComponent(error)}`, req.url))
  if (!state || !code) return NextResponse.json({ error: "Missing state or code" }, { status: 400 })

  const { rows } = await pool().query(
    `DELETE FROM oauth_states
     WHERE provider=$1 AND state=$2 AND expires_at > NOW()
     RETURNING redirect_to`,
    [provider, state]
  )
  if (!rows[0]) return NextResponse.json({ error: "Invalid or expired OAuth state" }, { status: 400 })

  await pool().query(
    `INSERT INTO integration_connections (provider, status, account_label, scopes, metadata, connected_at)
     VALUES ($1,'connected',$2,'{}',$3,NOW())
     ON CONFLICT (provider) DO UPDATE SET
       status='connected',
       account_label=EXCLUDED.account_label,
       metadata=EXCLUDED.metadata,
       connected_at=NOW(),
       updated_at=NOW()`,
    [
      provider,
      `${provider} connected`,
      JSON.stringify({
        codeReceived: true,
        note: "Token exchange/storage must be completed with production secret handling before publishing ads.",
      }),
    ]
  )

  return NextResponse.redirect(new URL(rows[0].redirect_to || "/integrations", req.url))
}
