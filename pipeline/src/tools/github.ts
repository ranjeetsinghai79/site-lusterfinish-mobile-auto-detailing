import { seal } from 'tweetsodium'

const BASE = 'https://api.github.com'

// ── Token pool: rotate on rate limit ──────────────────────────────────────────

function getTokenPool(): string[] {
  const pool: string[] = []
  for (let i = 1; i <= 10; i++) {
    const key = i === 1 ? 'GITHUB_TOKEN' : `GITHUB_TOKEN${i}`
    const val = process.env[key]
    if (val?.trim()) pool.push(val.trim())
  }
  return pool
}

let _tokenIdx = 0

function headers(token?: string): Record<string, string> {
  const pool = getTokenPool()
  const t = token ?? pool[_tokenIdx % pool.length] ?? ''
  return {
    Authorization: `token ${t}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github.v3+json',
  }
}

// Fetch with automatic token rotation on 403 rate limit
async function ghFetch(url: string, init?: RequestInit): Promise<Response> {
  const pool = getTokenPool()
  let attempts = 0

  while (attempts < pool.length) {
    const token = pool[_tokenIdx % pool.length]
    const hdrs = {
      ...headers(token),
      ...(init?.headers as Record<string, string> ?? {}),
    }
    const res = await fetch(url, { ...init, headers: hdrs })

    if (res.status === 401) {
      console.log(`[GitHub] Token ${_tokenIdx % pool.length + 1} bad credentials — rotating`)
      _tokenIdx++
      attempts++
      continue
    }

    if (res.status === 403 || res.status === 429) {
      const body = await res.text()
      if (body.includes('rate limit')) {
        console.log(`[GitHub] Token ${_tokenIdx % pool.length + 1} rate limited — rotating`)
        _tokenIdx++
        attempts++
        continue
      }
      // Non-rate-limit 403 — return as-is with a synthetic response
      return new Response(body, { status: res.status, headers: res.headers })
    }

    return res
  }

  throw new Error(`GitHub rate limit exceeded on all ${pool.length} token(s)`)
}

// ── GitHub Actions secret helpers ──────────────────────────────────────────

async function getRepoPublicKey(owner: string, repo: string): Promise<{ key_id: string; key: string } | null> {
  const res = await ghFetch(`${BASE}/repos/${owner}/${repo}/actions/secrets/public-key`)
  if (!res.ok) {
    console.error('[GitHub] get public key failed:', await res.text())
    return null
  }
  return res.json() as any
}

export async function setRepoSecret(params: {
  owner: string
  repo: string
  secretName: string
  secretValue: string
}): Promise<boolean> {
  const pk = await getRepoPublicKey(params.owner, params.repo)
  if (!pk) return false

  const keyBytes = Buffer.from(pk.key, 'base64')
  const msgBytes = Buffer.from(params.secretValue, 'utf8')
  const encrypted = Buffer.from(seal(msgBytes, keyBytes)).toString('base64')

  const res = await ghFetch(
    `${BASE}/repos/${params.owner}/${params.repo}/actions/secrets/${params.secretName}`,
    {
      method: 'PUT',
      body: JSON.stringify({ encrypted_value: encrypted, key_id: pk.key_id }),
    }
  )
  if (!res.ok && res.status !== 204) {
    console.error('[GitHub] set secret failed:', await res.text())
    return false
  }
  return true
}

export async function createRepoFromTemplate(params: {
  templateOwner: string
  templateRepo: string
  newOwner: string
  newRepoName: string
}): Promise<{ html_url: string } | null> {
  // Check if repo already exists — reuse it
  const existsRes = await ghFetch(`${BASE}/repos/${params.newOwner}/${params.newRepoName}`)
  if (existsRes.ok) {
    const existing = await existsRes.json() as any
    console.log(`[GitHub] reusing existing repo: ${existing.html_url}`)
    return { html_url: existing.html_url }
  }

  const pool = getTokenPool()
  console.log(`[GitHub] Using token pool: ${pool.length} token(s)`)

  const res = await ghFetch(
    `${BASE}/repos/${params.templateOwner}/${params.templateRepo}/generate`,
    {
      method: 'POST',
      body: JSON.stringify({
        owner: params.newOwner,
        name: params.newRepoName,
        description: `Website for ${params.newRepoName}`,
        private: false,
        include_all_branches: false,
      }),
    }
  )

  if (!res.ok) {
    console.error('[GitHub] create repo failed:', await res.text())
    return null
  }

  const data = await res.json() as any
  await new Promise(r => setTimeout(r, 4000))
  return { html_url: data.html_url }
}

export async function uploadBinaryFile(params: {
  owner: string
  repo: string
  path: string
  buffer: Buffer
  message: string
}): Promise<boolean> {
  const getRes = await ghFetch(
    `${BASE}/repos/${params.owner}/${params.repo}/contents/${params.path}`
  )
  const sha = getRes.ok ? (await getRes.json() as any).sha : undefined

  const putRes = await ghFetch(
    `${BASE}/repos/${params.owner}/${params.repo}/contents/${params.path}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message: params.message,
        content: params.buffer.toString('base64'),
        ...(sha ? { sha } : {}),
      }),
    }
  )
  if (!putRes.ok) {
    console.error('[GitHub] upload binary failed:', await putRes.text())
    return false
  }
  return true
}

export async function fetchFileContent(params: {
  owner: string
  repo: string
  path: string
}): Promise<string | null> {
  const res = await ghFetch(
    `${BASE}/repos/${params.owner}/${params.repo}/contents/${params.path}`
  )
  if (!res.ok) return null
  const data = await res.json() as any
  return Buffer.from(data.content, 'base64').toString('utf8')
}

export async function updateFile(params: {
  owner: string
  repo: string
  path: string
  content: string
  message: string
}): Promise<boolean> {
  const getRes = await ghFetch(
    `${BASE}/repos/${params.owner}/${params.repo}/contents/${params.path}`
  )
  const sha = getRes.ok ? (await getRes.json() as any).sha : undefined

  const putRes = await ghFetch(
    `${BASE}/repos/${params.owner}/${params.repo}/contents/${params.path}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message: params.message,
        content: Buffer.from(params.content).toString('base64'),
        ...(sha ? { sha } : {}),
      }),
    }
  )

  if (!putRes.ok) {
    console.error('[GitHub] upsert file failed:', await putRes.text())
    return false
  }

  return true
}
