import type { AuditReport, Lead } from '../types.js'
import type { GrowthPlan } from '../growth/types.js'
import type { SocialAssetDraft, SocialPlatform } from './types.js'
import { checkCompliance, complianceSummary } from '../compliance/index.js'

export function createSocialAssetDrafts(params: {
  lead?: Lead
  audit?: AuditReport
  plan?: GrowthPlan
  workspaceId?: string
  platforms?: SocialPlatform[]
}): SocialAssetDraft[] {
  const platforms: SocialPlatform[] = params.platforms?.length ? params.platforms : ['instagram', 'facebook']
  return platforms.flatMap((platform) => [
    createImagePost({ ...params, platform }),
    createCarousel({ ...params, platform }),
  ])
}

function createImagePost(params: {
  lead?: Lead
  audit?: AuditReport
  plan?: GrowthPlan
  workspaceId?: string
  platform: SocialPlatform
}): SocialAssetDraft {
  const businessName = params.audit?.business_name ?? params.lead?.name ?? params.plan?.businessName ?? 'the business'
  const niche = params.audit?.niche ?? params.lead?.niche ?? 'local service'
  const city = params.audit?.city ?? params.lead?.city ?? 'your area'
  const score = params.audit?.overall_score

  const title = score ? `${businessName} growth score: ${score}/100` : `${businessName} local growth update`
  const caption = score
    ? `${businessName} has a clear opportunity to turn more local searchers into booked appointments. We found the fastest wins: better calls to action, stronger local SEO, and a simpler booking path.`
    : `${businessName} is building a stronger local growth engine with a better website, faster follow-up, and clearer customer experience.`

  const compliance = checkCompliance({
    channel: 'social',
    platform: params.platform,
    niche,
    text: caption,
    requiresApproval: true,
  })

  return {
    workspaceId: params.workspaceId,
    leadId: params.lead?.id,
    assetType: 'image_post',
    platform: params.platform,
    title,
    caption,
    slides: [],
    imagePrompts: [
      `Professional branded social media image for ${businessName}, ${niche} in ${city}, clean premium local business aesthetic, no text, no logos, photorealistic`,
    ],
    hashtags: buildHashtags(niche, city),
    status: 'needs_approval',
    complianceWarnings: compliance.issues.map((issue) => `${issue.severity}:${issue.code}:${issue.fix}`),
  }
}

function createCarousel(params: {
  lead?: Lead
  audit?: AuditReport
  plan?: GrowthPlan
  workspaceId?: string
  platform: SocialPlatform
}): SocialAssetDraft {
  const businessName = params.audit?.business_name ?? params.lead?.name ?? params.plan?.businessName ?? 'the business'
  const niche = params.audit?.niche ?? params.lead?.niche ?? 'local service'
  const city = params.audit?.city ?? params.lead?.city ?? 'your area'
  const recommendations = params.audit?.recommendations?.slice(0, 3) ?? []

  const slides = [
    {
      title: `${businessName}: 3 growth opportunities`,
      body: `Local customers are already searching for ${niche} services in ${city}. The next step is turning that demand into booked leads.`,
      visualPrompt: `Hero carousel cover for ${businessName}, ${niche}, premium local business design, no text`,
    },
    ...recommendations.map((rec) => ({
      title: rec.title,
      body: rec.description,
      visualPrompt: `Clean educational carousel slide visual for ${niche}: ${rec.title}, premium brand style, no text`,
    })),
    {
      title: 'Next step',
      body: 'Improve the website, answer every call, and keep publishing useful local content every month.',
      visualPrompt: `Optimistic local business growth visual for ${niche} in ${city}, clean professional style, no text`,
    },
  ]

  const caption = `${businessName} can win more local customers by fixing the highest-impact parts of its growth system first: website conversion, follow-up, and local authority.`
  const compliance = checkCompliance({
    channel: 'social',
    platform: params.platform,
    niche,
    text: [caption, ...slides.map((slide) => `${slide.title} ${slide.body}`)].join(' '),
    requiresApproval: true,
  })

  return {
    workspaceId: params.workspaceId,
    leadId: params.lead?.id,
    assetType: 'carousel',
    platform: params.platform,
    title: `${businessName} growth carousel`,
    caption,
    slides,
    imagePrompts: slides.map((slide) => slide.visualPrompt),
    hashtags: buildHashtags(niche, city),
    status: 'needs_approval',
    complianceWarnings: compliance.issues.map((issue) => `${issue.severity}:${issue.code}:${issue.fix}`),
  }
}

function buildHashtags(niche: string, city: string): string[] {
  const cityTag = city.replace(/[^a-zA-Z0-9]/g, '')
  const nicheTag = niche.replace(/[^a-zA-Z0-9]/g, '')
  return [`#${cityTag}`, `#${nicheTag}`, '#LocalBusiness', '#SmallBusinessGrowth', '#BookMoreClients']
}
