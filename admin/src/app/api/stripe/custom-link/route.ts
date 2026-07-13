export const runtime = 'edge'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) return NextResponse.json({ error: 'No Stripe key' }, { status: 500 })

  const { amount, interval = 'month', description, clientEmail, clientName } = await req.json()

  if (!amount || amount < 1) {
    return NextResponse.json({ error: 'amount required (in dollars)' }, { status: 400 })
  }

  const amountCents = Math.round(Number(amount) * 100)

  // 1. Create a one-off Price
  const priceRes = await fetch('https://api.stripe.com/v1/prices', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      currency: 'usd',
      unit_amount: String(amountCents),
      'recurring[interval]': interval,
      'product_data[name]': description || `WebCrew ${interval === 'month' ? 'Monthly' : 'Annual'} Plan`,
    }).toString(),
  })

  const price = await priceRes.json() as { id: string; error?: { message: string } }
  if (price.error) return NextResponse.json({ error: price.error.message }, { status: 400 })

  // 2. Create Payment Link for that price
  const linkParams: Record<string, string> = {
    'line_items[0][price]': price.id,
    'line_items[0][quantity]': '1',
  }
  if (clientEmail) {
    linkParams['customer_creation'] = 'always'
  }

  const linkRes = await fetch('https://api.stripe.com/v1/payment_links', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(linkParams).toString(),
  })

  const link = await linkRes.json() as { url: string; id: string; error?: { message: string } }
  if (link.error) return NextResponse.json({ error: link.error.message }, { status: 400 })

  return NextResponse.json({
    url: link.url,
    price_id: price.id,
    link_id: link.id,
    amount_cents: amountCents,
    interval,
  })
}
