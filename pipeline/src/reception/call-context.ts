// Shared in-process state for active calls (server.ts writes, twilio-relay.ts reads)
// Note: single Cloud Run instance assumption. Multi-instance → move to Redis.

export interface CallMeta {
  configId: string
  leadName?: string
  demoUrl?: string
  triggerType?: 'email_click' | 'sms_reply' | 'form_submit' | 'manual'
  isOutbound?: boolean
}

export const callMeta = new Map<string, CallMeta>() // callSid → meta
