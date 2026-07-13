"use client"

import { useState } from "react"
import { Mail, ArrowRight, Loader2 } from "lucide-react"

export default function ClientLoginPage() {
  const [email,   setEmail]   = useState("")
  const [status,  setStatus]  = useState<"idle" | "loading" | "sent" | "error">("idle")
  const [message, setMessage] = useState("")
  const [devLink, setDevLink] = useState("")

  const params =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : null
  const expired = params?.get("error") === "expired"

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setStatus("loading")
    try {
      const res  = await fetch("/api/client/auth", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const data = await res.json()
      if (res.ok) {
        setStatus("sent")
        setMessage(data.message)
        if (data.devLink) setDevLink(data.devLink)
      } else {
        setStatus("error")
        setMessage(data.error ?? "Something went wrong")
      }
    } catch (e: any) {
      setStatus("error")
      setMessage(e.message)
    }
  }

  return (
    <div
      style={{
        minHeight:      "100vh",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        background:     "var(--bg)",
        padding:        "24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div
            style={{
              display:        "inline-flex",
              alignItems:     "center",
              justifyContent: "center",
              width:           48,
              height:          48,
              borderRadius:   12,
              background:     "var(--accent-dim-2)",
              border:         "1px solid rgba(99,102,241,0.3)",
              marginBottom:   16,
            }}
          >
            <Mail size={22} color="var(--accent-light)" />
          </div>
          <h1
            style={{
              fontSize:      22,
              fontWeight:    800,
              letterSpacing: "-0.03em",
              color:         "var(--text)",
              marginBottom:  6,
            }}
          >
            Your Website Dashboard
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-2)" }}>
            Enter your email to get a sign-in link
          </p>
        </div>

        {/* Expired notice */}
        {expired && (
          <div
            style={{
              background:   "var(--error-dim)",
              border:       "1px solid rgba(239,68,68,0.3)",
              borderRadius: 8,
              padding:      "10px 14px",
              fontSize:     13,
              color:        "var(--error)",
              marginBottom: 20,
              textAlign:    "center",
            }}
          >
            That link has expired. Request a new one below.
          </div>
        )}

        {/* Card */}
        <div
          style={{
            background:   "var(--surface)",
            border:       "1px solid var(--border)",
            borderRadius: 14,
            padding:      "28px",
          }}
        >
          {status !== "sent" ? (
            <form onSubmit={submit}>
              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    display:       "block",
                    fontSize:      11,
                    fontWeight:    700,
                    color:         "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    marginBottom:  8,
                  }}
                >
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="owner@yourbusiness.com"
                  required
                  autoFocus
                  style={{
                    width:        "100%",
                    background:   "var(--surface-2)",
                    border:       "1px solid var(--border-2)",
                    borderRadius: 8,
                    color:        "var(--text)",
                    padding:      "10px 13px",
                    fontSize:     14,
                    outline:      "none",
                  }}
                />
              </div>

              {status === "error" && (
                <div
                  style={{
                    background:   "var(--error-dim)",
                    border:       "1px solid rgba(239,68,68,0.3)",
                    borderRadius: 7,
                    padding:      "9px 12px",
                    fontSize:     13,
                    color:        "var(--error)",
                    marginBottom: 14,
                  }}
                >
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={status === "loading" || !email.trim()}
                style={{
                  width:        "100%",
                  background:
                    status === "loading" || !email.trim()
                      ? "var(--border-2)"
                      : "var(--accent)",
                  color:        "#fff",
                  border:       "none",
                  borderRadius: 8,
                  padding:      "11px",
                  fontWeight:   700,
                  fontSize:     14,
                  cursor:
                    status === "loading" || !email.trim()
                      ? "not-allowed"
                      : "pointer",
                  display:        "flex",
                  alignItems:     "center",
                  justifyContent: "center",
                  gap:            8,
                  transition:     "background 0.12s",
                }}
              >
                {status === "loading" ? (
                  <>
                    <Loader2 size={15} className="anim-spin" />
                    Sending link…
                  </>
                ) : (
                  <>
                    Send magic link
                    <ArrowRight size={15} />
                  </>
                )}
              </button>
            </form>
          ) : (
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  width:          44,
                  height:         44,
                  borderRadius:   "50%",
                  background:     "var(--success-dim)",
                  border:         "1px solid rgba(16,185,129,0.3)",
                  display:        "flex",
                  alignItems:     "center",
                  justifyContent: "center",
                  margin:         "0 auto 16px",
                }}
              >
                <Mail size={20} color="var(--success)" />
              </div>
              <div
                style={{
                  fontSize:   15,
                  fontWeight: 700,
                  color:      "var(--text)",
                  marginBottom: 8,
                }}
              >
                Check your inbox
              </div>
              <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 20 }}>
                We sent a sign-in link to <strong style={{ color: "var(--text)" }}>{email}</strong>. It expires in 15 minutes.
              </p>

              {devLink && (
                <div
                  style={{
                    background:   "var(--surface-2)",
                    border:       "1px solid var(--border-2)",
                    borderRadius: 7,
                    padding:      "10px 12px",
                    marginBottom: 16,
                  }}
                >
                  <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                    Dev mode — link
                  </div>
                  <a
                    href={devLink}
                    style={{ fontSize: 12, color: "var(--accent-light)", wordBreak: "break-all" }}
                  >
                    {devLink}
                  </a>
                </div>
              )}

              <button
                onClick={() => { setStatus("idle"); setEmail(""); setMessage(""); setDevLink("") }}
                style={{
                  fontSize:       12,
                  color:          "var(--muted)",
                  background:     "transparent",
                  border:         "none",
                  cursor:         "pointer",
                  textDecoration: "underline",
                }}
              >
                Use a different email
              </button>
            </div>
          )}
        </div>

        <p style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginTop: 20 }}>
          This portal is for website clients only.{" "}
          <a href="/" style={{ color: "var(--accent-light)", textDecoration: "none" }}>Admin →</a>
        </p>
      </div>
    </div>
  )
}
