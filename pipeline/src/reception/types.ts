export interface BusinessBrain {
  name: string
  type: string
  address?: string
  phone?: string
  email?: string
  hours: Record<string, string>        // { monday: "9am-5pm", tuesday: "closed", ... }
  services: Array<{
    name: string
    price?: string
    duration?: string
    description?: string
  }>
  booking_url?: string
  booking_instructions?: string
  faqs: Array<{ question: string; answer: string }>
  special_notes?: string
  owner_phone?: string                  // HITL escalation target
}

export interface ReceptionConfig {
  id: string
  lead_id?: string
  website_url: string
  business_name: string
  brain: BusinessBrain
  system_prompt: string
  twilio_phone?: string
  active: boolean
  created_at: string
}
