export type SocialAssetType = 'image_post' | 'carousel'
export type SocialPlatform = 'instagram' | 'facebook' | 'linkedin' | 'google_business_profile'

export interface SocialSlide {
  title: string
  body: string
  visualPrompt: string
}

export interface SocialAssetDraft {
  workspaceId?: string
  leadId?: string
  assetType: SocialAssetType
  platform: SocialPlatform
  title: string
  caption: string
  slides: SocialSlide[]
  imagePrompts: string[]
  hashtags: string[]
  status: 'draft' | 'needs_approval' | 'approved' | 'scheduled' | 'published'
  complianceWarnings?: string[]
}
