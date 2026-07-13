import { GoogleGenAI } from '@google/genai'
import { bootstrapADC } from './gcp-auth.js'

// Ensure ADC is available before SDK init
bootstrapADC()

const PROJECT  = process.env.GCP_PROJECT_ID ?? 'gen-lang-client-0844283339'
const LOCATION = process.env.GCP_REGION    ?? 'us-central1'

const _ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION })

// Vertex AI model IDs — confirmed working on gen-lang-client-0844283339 (July 2026)
// gemini-3.x requires project allowlist — not yet enabled on this project
export const GEMINI_PRO   = 'gemini-2.5-pro'    // best available — $1.25/$10 per 1M tokens
export const GEMINI_FLASH = 'gemini-2.5-flash'  // bulk ops — $0.30/$2.50 per 1M tokens

export interface GeminiOpts {
  model?: string
  maxTokens?: number
  temperature?: number
  systemInstruction?: string
}

export async function geminiText(prompt: string, opts: GeminiOpts = {}): Promise<string> {
  const { model = GEMINI_FLASH, maxTokens, temperature, systemInstruction } = opts
  const config: Record<string, any> = {}
  if (maxTokens)             config.maxOutputTokens  = maxTokens
  if (temperature != null)   config.temperature      = temperature
  if (systemInstruction)     config.systemInstruction = systemInstruction

  const result = await _ai.models.generateContent({
    model,
    contents: prompt,
    ...(Object.keys(config).length ? { config } : {}),
  })
  return result.text ?? ''
}
