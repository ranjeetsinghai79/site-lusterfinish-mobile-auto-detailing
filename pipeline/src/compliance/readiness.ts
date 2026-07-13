export interface LaunchReadinessItem {
  area: string
  status: 'ready' | 'blocked' | 'manual'
  requirement: string
}

export function getLaunchReadiness(env: NodeJS.ProcessEnv = process.env): LaunchReadinessItem[] {
  return [
    {
      area: 'Database',
      status: env.DATABASE_URL ? 'ready' : 'blocked',
      requirement: 'DATABASE_URL set and migrations v6-v9 applied.',
    },
    {
      area: 'AI',
      status: env.GOOGLE_AI_API_KEY ? 'ready' : 'blocked',
      requirement: 'GOOGLE_AI_API_KEY set for audits, planning, reception, and content.',
    },
    {
      area: 'Email',
      status: env.RESEND_API_KEY ? 'ready' : 'blocked',
      requirement: 'RESEND_API_KEY and verified sending domain configured.',
    },
    {
      area: 'SMS',
      status: env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER ? 'manual' : 'blocked',
      requirement: 'Twilio configured, opt-in source stored, STOP respected, quiet hours policy documented.',
    },
    {
      area: 'Reception',
      status: env.RECEPTION_SERVER_URL || env.GEMINI_API_KEY ? 'manual' : 'blocked',
      requirement: 'AI receptionist deployed, call disclosure reviewed, booking handoff tested.',
    },
    {
      area: 'Ads',
      status: env.GOOGLE_ADS_CLIENT_ID && env.META_APP_ID ? 'manual' : 'blocked',
      requirement: 'Google/Meta OAuth client IDs set, pixel/conversion tracking planned, approval UI, and spend caps tested.',
    },
    {
      area: 'Compliance',
      status: env.PUBLIC_PRIVACY_URL && env.PUBLIC_TERMS_URL ? 'manual' : 'blocked',
      requirement: 'TCPA/SMS consent, call recording consent, health/legal ad review, privacy/terms pages reviewed.',
    },
  ]
}
