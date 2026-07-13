"use client"

import { useState } from "react"
import { X, CreditCard, Copy, Check, ExternalLink, Send } from "lucide-react"
import type { Lead } from "@/lib/db"

const PRESETS = [
  { key: "site",      label: "Website",       amount: 299,  interval: "one-time", desc: "Website ownership — hosted on Cloudflare Pages" },
  { key: "basic",     label: "Basic Plan",    amount: 49,   interval: "monthly",  desc: "Hosting + GBP posts + review replies + traffic report" },
  { key: "reception", label: "AI Reception",  amount: 149,  interval: "monthly",  desc: "Everything in Basic + AI call answering + appointment booking" },
  { key: "custom",    label: "Custom",        amount: 0,    interval: "one-time", desc: "Set your own price for this client" },
]

interface Props {
  lead: Lead
  onClose: () => void
  onSuccess: (url: string, status: string) => void
}

export function PaymentModal({ lead, onClose, onSuccess }: Props) {
  const [selected,     setSelected]     = useState<string>("site")
  const [customAmt,    setCustomAmt]    = useState<string>("")
  const [customDesc,   setCustomDesc]   = useState<string>("")
  const [interval,     setInterval]     = useState<"one-time" | "monthly">("one-time")
  const [note,         setNote]         = useState<string>("")
  const [loading,      setLoading]      = useState(false)
  const [result,       setResult]       = useState<{ url: string } | null>(null)
  const [copied,       setCopied]       = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [emailSending, setEmailSending] = useState(false)
  const [emailSent,    setEmailSent]    = useState(false)

  const preset   = PRESETS.find(p => p.key === selected)!
  const isCustom = selected === "custom"

  const finalAmount = isCustom
    ? parseFloat(customAmt || "0")
    : preset.amount
  const finalInterval = isCustom ? interval : preset.interval as "one-time" | "monthly"
  const finalDesc     = isCustom
    ? (customDesc || `WebCrew — Custom plan for ${lead.name}`)
    : preset.desc

  async function generate() {
    if (finalAmount <= 0) { setError("Enter a valid amount"); return }
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/leads/${lead.id}/checkout`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          plan:              isCustom ? "custom" : selected,
          custom_amount:     isCustom ? Math.round(finalAmount * 100) : undefined,
          custom_description: isCustom ? finalDesc : undefined,
          custom_interval:   isCustom ? finalInterval : undefined,
          note,
          send_email: false,   // generate link only — user can send separately
        }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error); return }
      setResult({ url: d.checkoutUrl })
      onSuccess(d.checkoutUrl, "payment_link_sent")
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function sendEmail() {
    if (!result) return
    setEmailSending(true)
    try {
      const res = await fetch(`/api/leads/${lead.id}/checkout`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          plan:              isCustom ? "custom" : selected,
          custom_amount:     isCustom ? Math.round(finalAmount * 100) : undefined,
          custom_description: isCustom ? finalDesc : undefined,
          custom_interval:   isCustom ? finalInterval : undefined,
          note,
          send_email: true,
          checkout_url: result.url,  // reuse same URL, don't create new session
        }),
      })
      if (res.ok) setEmailSent(true)
    } finally {
      setEmailSending(false)
    }
  }

  function copyLink() {
    if (!result?.url) return
    navigator.clipboard.writeText(result.url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const overlay: React.CSSProperties = {
    position:       "fixed",
    inset:          0,
    background:     "rgba(0,0,0,0.7)",
    backdropFilter: "blur(4px)",
    zIndex:         1000,
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    padding:        "20px",
  }

  const modal: React.CSSProperties = {
    background:   "var(--surface, #111827)",
    border:       "1px solid var(--border, rgba(255,255,255,0.1))",
    borderRadius: 16,
    width:        "100%",
    maxWidth:     520,
    overflow:     "hidden",
    boxShadow:    "0 24px 80px rgba(0,0,0,0.6)",
  }

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={modal}>

        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border, rgba(255,255,255,0.08))", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <CreditCard size={16} style={{ color: "#10b981" }} />
              <span style={{ color: "var(--text, #fff)", fontWeight: 700, fontSize: 15 }}>Send Payment Link</span>
            </div>
            <p style={{ margin: 0, color: "var(--muted, rgba(255,255,255,0.5))", fontSize: 12 }}>
              {lead.name} · {lead.email ?? "no email"}
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "20px 24px" }}>

          {/* Plan selector */}
          <p style={{ margin: "0 0 10px", color: "var(--muted, rgba(255,255,255,0.5))", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Plan</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
            {PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => {
                  setSelected(p.key)
                  if (p.key !== "custom") setInterval(p.interval as any)
                }}
                style={{
                  background:   selected === p.key ? "rgba(99,102,241,0.2)" : "var(--surface-2, #1e293b)",
                  border:       selected === p.key ? "1px solid rgba(99,102,241,0.6)" : "1px solid var(--border, rgba(255,255,255,0.08))",
                  borderRadius: 10,
                  padding:      "12px 14px",
                  cursor:       "pointer",
                  textAlign:    "left",
                  transition:   "all 0.15s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ color: "var(--text, #fff)", fontWeight: 700, fontSize: 13 }}>{p.label}</span>
                  {p.key !== "custom" && (
                    <span style={{ color: "#10b981", fontSize: 13, fontWeight: 800 }}>
                      ${p.amount}{p.interval === "monthly" ? "/mo" : ""}
                    </span>
                  )}
                  {p.key === "custom" && (
                    <span style={{ color: "var(--muted)", fontSize: 11 }}>free-form</span>
                  )}
                </div>
                <p style={{ margin: "3px 0 0", color: "var(--muted, rgba(255,255,255,0.45))", fontSize: 11, lineHeight: 1.4 }}>
                  {p.key === "custom" ? "Negotiate any price, one-time or monthly" : p.desc}
                </p>
              </button>
            ))}
          </div>

          {/* Custom fields */}
          {isCustom && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ display: "block", color: "var(--muted)", fontSize: 11, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Amount (USD)</label>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: 14, fontWeight: 700 }}>$</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="299"
                      value={customAmt}
                      onChange={e => setCustomAmt(e.target.value)}
                      style={{ width: "100%", background: "var(--surface-2, #1e293b)", border: "1px solid var(--border, rgba(255,255,255,0.12))", borderRadius: 8, color: "var(--text, #fff)", padding: "9px 10px 9px 24px", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                    />
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", color: "var(--muted)", fontSize: 11, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Billing</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["one-time", "monthly"] as const).map(v => (
                      <button
                        key={v}
                        onClick={() => setInterval(v)}
                        style={{
                          flex:         1,
                          background:   interval === v ? "rgba(99,102,241,0.25)" : "var(--surface-2, #1e293b)",
                          border:       interval === v ? "1px solid rgba(99,102,241,0.5)" : "1px solid var(--border, rgba(255,255,255,0.08))",
                          borderRadius: 8,
                          color:        interval === v ? "#a5b4fc" : "var(--muted)",
                          fontSize:     12,
                          fontWeight:   600,
                          padding:      "9px 6px",
                          cursor:       "pointer",
                        }}
                      >
                        {v === "one-time" ? "One-time" : "Monthly"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <label style={{ display: "block", color: "var(--muted)", fontSize: 11, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Description (shown on checkout)</label>
                <input
                  type="text"
                  placeholder={`WebCrew — Custom plan for ${lead.name}`}
                  value={customDesc}
                  onChange={e => setCustomDesc(e.target.value)}
                  style={{ width: "100%", background: "var(--surface-2, #1e293b)", border: "1px solid var(--border, rgba(255,255,255,0.12))", borderRadius: 8, color: "var(--text, #fff)", padding: "9px 12px", fontSize: 13, outline: "none", boxSizing: "border-box" }}
                />
              </div>
            </div>
          )}

          {/* Note (optional) */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", color: "var(--muted)", fontSize: 11, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
              Note to client <span style={{ textTransform: "none", opacity: 0.6 }}>(optional — shown in email subject)</span>
            </label>
            <input
              type="text"
              placeholder='e.g. "Special rate as discussed on our call"'
              value={note}
              onChange={e => setNote(e.target.value)}
              style={{ width: "100%", background: "var(--surface-2, #1e293b)", border: "1px solid var(--border, rgba(255,255,255,0.12))", borderRadius: 8, color: "var(--text, #fff)", padding: "9px 12px", fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
          </div>

          {/* Price summary */}
          {finalAmount > 0 && (
            <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 10, padding: "12px 16px", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>
                {isCustom ? (customDesc || `Custom plan`) : preset.desc}
              </span>
              <span style={{ color: "#10b981", fontWeight: 800, fontSize: 17 }}>
                ${finalAmount}{finalInterval === "monthly" ? "/mo" : ""}
              </span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#fca5a5", fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Result: link generated */}
          {result ? (
            <div>
              <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
                <p style={{ margin: "0 0 8px", color: "#6ee7b7", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>✓ Checkout link ready</p>
                <p style={{ margin: 0, color: "rgba(255,255,255,0.5)", fontSize: 11, wordBreak: "break-all", fontFamily: "monospace" }}>
                  {result.url.slice(0, 60)}…
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={copyLink}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: copied ? "rgba(16,185,129,0.2)" : "var(--surface-2, #1e293b)", border: `1px solid ${copied ? "rgba(16,185,129,0.5)" : "var(--border, rgba(255,255,255,0.12))"}`, borderRadius: 9, padding: "11px 16px", color: copied ? "#6ee7b7" : "var(--text, #fff)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied!" : "Copy Link"}
                </button>
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "var(--surface-2, #1e293b)", border: "1px solid var(--border, rgba(255,255,255,0.12))", borderRadius: 9, padding: "11px 16px", color: "var(--text, #fff)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}
                >
                  <ExternalLink size={14} /> Preview
                </a>
                {lead.email && (
                  <button
                    onClick={sendEmail}
                    disabled={emailSending || emailSent}
                    style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: emailSent ? "rgba(16,185,129,0.2)" : "rgba(99,102,241,0.2)", border: `1px solid ${emailSent ? "rgba(16,185,129,0.4)" : "rgba(99,102,241,0.4)"}`, borderRadius: 9, padding: "11px 16px", color: emailSent ? "#6ee7b7" : "#a5b4fc", fontSize: 13, fontWeight: 600, cursor: emailSent ? "default" : "pointer", opacity: emailSending ? 0.6 : 1 }}
                  >
                    {emailSent ? <Check size={14} /> : <Send size={14} />}
                    {emailSent ? "Sent!" : emailSending ? "Sending…" : "Email to Client"}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <button
              onClick={generate}
              disabled={loading || finalAmount <= 0}
              style={{ width: "100%", background: "linear-gradient(135deg,#6366f1,#4f46e5)", border: "none", borderRadius: 10, padding: "13px 20px", color: "#fff", fontSize: 14, fontWeight: 700, cursor: loading || finalAmount <= 0 ? "not-allowed" : "pointer", opacity: loading || finalAmount <= 0 ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              <CreditCard size={15} />
              {loading ? "Generating…" : `Generate $${finalAmount > 0 ? finalAmount : "—"}${finalInterval === "monthly" ? "/mo" : ""} Link`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
