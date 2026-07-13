import { geminiText, GEMINI_FLASH }     from '../tools/gemini.js'
import { listReviews, replyToReview } from '../tools/google-my-business.js'
import type { Lead, AgentResult }     from '../types.js'

export async function runReviewsAgent(
  lead: Lead
): Promise<AgentResult<{ replied: number; skipped: number }>> {
  const accountId  = lead.gbp_account_id  ?? process.env.GBP_ACCOUNT_ID
  const locationId = lead.gbp_location_id ?? process.env.GBP_LOCATION_ID

  if (!accountId || !locationId) {
    return { success: false, error: `No GBP credentials for ${lead.name} — set gbp_account_id/gbp_location_id on lead or GBP_ACCOUNT_ID/GBP_LOCATION_ID env` }
  }

  try {
    const reviews = await listReviews({ accountId, locationId })

    const unanswered = reviews.filter((r: any) => !r.reviewReply)
    let replied = 0
    let skipped = 0

    for (const review of unanswered.slice(0, 10)) {
      const rating   = review.starRating
      const text     = review.comment || ''
      const reviewer = review.reviewer?.displayName || 'Customer'

      const replyText = await geminiText(
        `Write a professional Google review reply for ${lead.name} (${lead.niche} business).
Reviewer: ${reviewer}
Rating: ${rating}
Review: "${text}"

2-3 sentences. Thank them, address their specific feedback, invite them back. If negative, apologize and offer to make it right. No emojis.`,
        { model: GEMINI_FLASH, maxTokens: 250 }
      )

      const success = await replyToReview({
        accountId,
        locationId,
        reviewId: review.reviewId,
        replyText,
      })

      if (success) replied++
      else skipped++
    }

    return { success: true, data: { replied, skipped } }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}
