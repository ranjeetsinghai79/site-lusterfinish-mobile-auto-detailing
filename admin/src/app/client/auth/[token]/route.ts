export const runtime = 'edge'
import { NextRequest, NextResponse } from "next/server"
import { validateMagicToken } from "@/lib/db"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const email = await validateMagicToken(token)

  if (!email) {
    return NextResponse.redirect(new URL("/client/login?error=expired", req.url))
  }

  const res = NextResponse.redirect(new URL("/client/dashboard", req.url))
  res.cookies.set("client_email", email, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
    sameSite: "lax",
  })
  return res
}
