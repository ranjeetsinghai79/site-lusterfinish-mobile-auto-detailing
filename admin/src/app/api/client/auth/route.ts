export const runtime = 'edge'
import { NextRequest, NextResponse } from "next/server"
import { createMagicToken, getClientLead } from "@/lib/db"

export async function POST(req: NextRequest) {
  const { email } = await req.json()

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 })
  }

  try {
    const lead = await getClientLead(email)
    if (!lead) {
      return NextResponse.json(
        { error: "No account found for this email address." },
        { status: 404 }
      )
    }

    const token = await createMagicToken(email)
    const base = process.env.NEXT_PUBLIC_URL ?? "http://localhost:3010"
    const magicLink = `${base}/client/auth/${token}`

    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      const from = process.env.OUTREACH_FROM_EMAIL ?? "noreply@websitedeveloper.ai"
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: email,
          subject: `Sign in to ${lead.name} Dashboard`,
          html: `
            <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#07070f;color:#e2e8f0;border-radius:12px;">
              <div style="margin-bottom:24px;">
                <div style="font-size:20px;font-weight:800;margin-bottom:6px;">Your dashboard is ready</div>
                <div style="color:#94a3b8;font-size:14px;">Sign in to view your website status, analytics, and invoices for <strong style="color:#e2e8f0;">${lead.name}</strong>.</div>
              </div>
              <a href="${magicLink}" style="display:inline-block;background:#6366f1;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">
                Open Dashboard →
              </a>
              <div style="margin-top:24px;color:#4a5568;font-size:12px;line-height:1.6;">
                This link expires in 15 minutes. If you didn't request this, ignore this email.
              </div>
            </div>
          `,
        }),
      })
    }

    return NextResponse.json({
      ok: true,
      message: "Magic link sent — check your email.",
      ...(process.env.NODE_ENV !== "production" && { devLink: magicLink }),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
