import { GoogleGenAI, Modality, EndSensitivity, StartSensitivity } from '@google/genai'

// Gemini Live API via @google/genai SDK.
// Vertex AI backend uses Application Default Credentials (ADC) — automatic in Cloud Run.
// No API key or manual token management needed.
//
// Set GEMINI_LIVE_BACKEND=aistudio to use AI Studio (requires GOOGLE_AI_API_KEY).
// Default: vertex (bills to GCP project, no prepay credits).

const BACKEND  = process.env.GEMINI_LIVE_BACKEND ?? 'vertex'
const PROJECT  = process.env.GCP_PROJECT_ID      ?? 'gen-lang-client-0844283339'
const LOCATION = process.env.GCP_REGION          ?? 'us-central1'

// Vertex model IDs for Live API — gemini-live-2.5-flash-native-audio confirmed available on this project
const VERTEX_MODEL   = process.env.GEMINI_LIVE_MODEL_VERTEX  ?? 'gemini-live-2.5-flash-native-audio'
const AISTUDIO_MODEL = process.env.GEMINI_LIVE_MODEL         ?? 'models/gemini-2.5-flash-native-audio-latest'

function makeClient() {
  if (BACKEND === 'aistudio') {
    const apiKey = process.env.GOOGLE_AI_API_KEY
    if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set')
    return new GoogleGenAI({ apiKey })
  }
  return new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION })
}

export interface GeminiLiveCallbacks {
  onReady: () => void
  onAudio: (base64Pcm24kHz: string) => void
  onText?: (text: string) => void
  onToolCall: (name: string, args: Record<string, unknown>, callId: string) => void
  onError: (err: Error) => void
  onClose: () => void
}

export class GeminiLiveSession {
  private session: Awaited<ReturnType<typeof GoogleGenAI.prototype.live.connect>> | null = null
  private callbacks: GeminiLiveCallbacks
  private _ready = false

  get isReady() { return this._ready }

  constructor(callbacks: GeminiLiveCallbacks) {
    this.callbacks = callbacks
  }

  // Swap in real callbacks after pre-warm. If already ready, fires onReady immediately.
  setCallbacks(callbacks: GeminiLiveCallbacks) {
    this.callbacks = callbacks
    if (this._ready) setTimeout(() => callbacks.onReady(), 0)
  }

  async connect(systemPrompt: string): Promise<void> {
    const ai    = makeClient()
    const model = BACKEND === 'aistudio' ? AISTUDIO_MODEL : VERTEX_MODEL
    console.log(`[Gemini] ${BACKEND} → ${model}`)

    this.session = await ai.live.connect({
      model,
      config: {
        responseModalities:  [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
        },
        systemInstruction: { parts: [{ text: systemPrompt }] },
        tools:             [{ functionDeclarations: TOOL_DECLARATIONS as any }],
        // Warmer, more emotionally attuned responses — native-audio models only
        enableAffectiveDialog: true,
        // Graceful turn-taking: let callers pause to think (booking a date, recalling
        // an email) without the AI jumping in or cutting them off mid-sentence.
        realtimeInputConfig: {
          automaticActivityDetection: {
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
            endOfSpeechSensitivity:   EndSensitivity.END_SENSITIVITY_LOW,
            silenceDurationMs:        700,
            prefixPaddingMs:          200,
          },
        },
      },
      callbacks: {
        onopen: () => {
          console.log(`[Gemini] Connected — ${model}`)
          this._ready = true
          this.callbacks.onReady()
        },
        onmessage: (msg: any) => {
          try {
            this.handle(msg)
          } catch (err: any) {
            console.warn('[Gemini] handle error:', err.message)
          }
        },
        onerror: (e: any) => {
          const err = new Error(e?.error?.message ?? e?.message ?? 'Gemini WS error')
          console.error('[Gemini] error:', err.message)
          this.callbacks.onError(err)
        },
        onclose: (e: any) => {
          console.log(`[Gemini] closed — code: ${e?.code}, reason: ${e?.reason ?? ''}`)
          this.callbacks.onClose()
        },
      },
    })
  }

  private handle(msg: any) {
    const parts = msg.serverContent?.modelTurn?.parts ?? []
    for (const part of parts) {
      const data = part.inlineData?.data
      const mime = part.inlineData?.mimeType ?? ''
      if (data && mime.startsWith('audio/pcm')) this.callbacks.onAudio(data)
      if (part.text && this.callbacks.onText) this.callbacks.onText(part.text)
    }

    const functionCalls = msg.toolCall?.functionCalls ?? []
    for (const fc of functionCalls) {
      this.callbacks.onToolCall(fc.name, fc.args ?? {}, fc.id)
    }
  }

  sendText(text: string) {
    this.session?.sendClientContent({
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete: true,
    } as any)
  }

  sendAudio(base64Pcm16kHz: string) {
    this.session?.sendRealtimeInput({
      audio: { data: base64Pcm16kHz, mimeType: 'audio/pcm;rate=16000' },
    } as any)
  }

  respondToTool(callId: string, name: string, output: unknown) {
    try {
      this.session?.sendToolResponse({
        functionResponses: [{ id: callId, name, response: { output } }],
      } as any)
    } catch (e: any) {
      console.error('[Gemini] sendToolResponse failed:', e.message)
    }
  }

  close() {
    try { (this.session as any)?.close?.() } catch { /* ignore */ }
    this.session = null
  }
}

// ── Tool declarations ─────────────────────────────────────────────────────────

const TOOL_DECLARATIONS = [
  {
    name: 'escalate_to_human',
    description: 'Transfer the call to a human when caller requests it or AI cannot resolve the issue',
    parameters: {
      type: 'OBJECT',
      properties: { reason: { type: 'STRING', description: 'Brief reason for escalation' } },
      required: ['reason'],
    },
  },
  {
    name: 'take_message',
    description: 'Record lead info from a caller who has SPOKEN and provided their details. ONLY call after real two-way conversation. Never call before the caller responds to your greeting.',
    parameters: {
      type: 'OBJECT',
      properties: {
        caller_name:  { type: 'STRING', description: "Caller's full name (must be provided by caller)" },
        caller_phone: { type: 'STRING', description: "Caller's callback number" },
        caller_email: { type: 'STRING', description: "Caller's email address for sending the demo site link" },
        message:      { type: 'STRING', description: 'Summary of lead info: niche, city, has_website, notes' },
      },
      required: ['caller_name', 'message'],
    },
  },
  {
    name: 'end_call',
    description: 'End the call after saying a proper goodbye. ONLY use when: caller says goodbye/thanks/done, issue is fully resolved, or after confirming a booking. NEVER call this before the caller has responded to your greeting.',
    parameters: {
      type: 'OBJECT',
      properties: { reason: { type: 'STRING', description: 'brief reason (resolved, booked, escalated, etc.)' } },
      required: [],
    },
  },
  {
    name: 'check_availability',
    description: 'Check available appointment slots for the next 5 business days. Call this when a caller wants to book an appointment.',
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
  {
    name: 'book_appointment',
    description: 'Book an appointment for the caller. Only call after confirming the time slot with the caller.',
    parameters: {
      type: 'OBJECT',
      properties: {
        caller_name:  { type: 'STRING', description: "Caller's full name" },
        caller_email: { type: 'STRING', description: "Caller's email address" },
        caller_phone: { type: 'STRING', description: "Caller's phone number" },
        slot_time:    { type: 'STRING', description: 'ISO datetime of the selected slot (from check_availability results)' },
        notes:        { type: 'STRING', description: 'Any special notes or reason for appointment' },
      },
      required: ['caller_name', 'caller_email', 'slot_time'],
    },
  },
]
