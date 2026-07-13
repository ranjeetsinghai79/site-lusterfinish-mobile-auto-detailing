export const runtime = 'edge'
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { getClientLead, getClientLocations } from "@/lib/db"
import { ClientLogout } from "@/components/client-logout"
import { Globe, Star, CheckCircle, Clock, AlertCircle, ExternalLink, MessageSquare, MapPin } from "lucide-react"

export const dynamic = "force-dynamic"

const STATUS_LABEL: Record<string, { label: string; color: string; icon: any }> = {
  deployed:           { label: "Live",          color: "var(--success)", icon: CheckCircle },
  outreach_sent:      { label: "Live",          color: "var(--success)", icon: CheckCircle },
  sms_sent:           { label: "Live",          color: "var(--success)", icon: CheckCircle },
  conversation_active:{ label: "In Progress",   color: "var(--info)",    icon: Clock },
  meeting_scheduled:  { label: "Meeting Set",   color: "var(--accent-light)", icon: Clock },
  payment_link_sent:  { label: "Payment Sent",  color: "var(--warning)", icon: Clock },
  paid:               { label: "Active Client", color: "var(--paid)",    icon: CheckCircle },
  handed_off:         { label: "Active Client", color: "var(--paid)",    icon: CheckCircle },
  built:              { label: "Building",      color: "var(--warning)", icon: Clock },
  analyzed:           { label: "Preparing",     color: "var(--warning)", icon: Clock },
  error:              { label: "Issue Detected",color: "var(--error)",   icon: AlertCircle },
}

const PLAN_LABEL: Record<string, { label: string; color: string }> = {
  launch: { label: "Launch",  color: "#f59e0b" },
  grow:   { label: "Grow",    color: "#6366f1" },
  scale:  { label: "Scale",   color: "#10b981" },
}

export default async function ClientDashboardPage() {
  const store = await cookies()
  const email = store.get("client_email")?.value
  if (!email) redirect("/client/login")

  const lead = await getClientLead(email)
  if (!lead) redirect("/client/login?error=not-found")

  // Scale: fetch all locations; others: single lead
  const locations = await getClientLocations(email)
  const isMultiLocation = locations.length > 1

  const siteUrl = lead.cloudflare_url ?? lead.vercel_url
  const statusInfo = STATUS_LABEL[lead.status] ?? { label: lead.status, color: "var(--muted)", icon: Clock }
  const StatusIcon = statusInfo.icon
  const planInfo = PLAN_LABEL[lead.client_plan ?? "launch"] ?? PLAN_LABEL.launch

  return (
    <div
      style={{
        minHeight:   "100vh",
        background:  "var(--bg)",
        padding:     "0 0 60px",
      }}
    >
      {/* Header */}
      <header
        style={{
          background:  "var(--surface)",
          borderBottom: "1px solid var(--border)",
          padding:     "14px 32px",
          display:     "flex",
          alignItems:  "center",
          gap:         16,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontWeight:    800,
              fontSize:      15,
              letterSpacing: "-0.02em",
              color:         "var(--text)",
            }}
          >
            {lead.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>
            {lead.city}, {lead.state} · {lead.niche}
          </div>
        </div>
        <ClientLogout />
      </header>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px" }}>

        {/* Site status card */}
        <div
          style={{
            background:   "var(--surface)",
            border:       "1px solid var(--border)",
            borderRadius: 14,
            padding:      "24px 28px",
            marginBottom: 20,
          }}
        >
          <div
            style={{
              display:        "flex",
              alignItems:     "center",
              justifyContent: "space-between",
              marginBottom:   20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <StatusIcon size={18} color={statusInfo.color} />
              <span
                style={{
                  fontSize:   15,
                  fontWeight: 700,
                  color:      statusInfo.color,
                }}
              >
                {statusInfo.label}
              </span>
            </div>
            {siteUrl && (
              <a
                href={siteUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display:      "flex",
                  alignItems:   "center",
                  gap:          6,
                  background:   "var(--accent)",
                  color:        "#fff",
                  padding:      "9px 18px",
                  borderRadius: 8,
                  fontWeight:   700,
                  fontSize:     13,
                  textDecoration: "none",
                }}
              >
                <Globe size={14} />
                View Your Site
                <ExternalLink size={12} />
              </a>
            )}
          </div>

          <div
            style={{
              background:   "var(--surface-2)",
              border:       "1px solid var(--border)",
              borderRadius: 8,
              padding:      "12px 16px",
            }}
          >
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Website URL
            </div>
            {siteUrl ? (
              <a
                href={siteUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color:          "var(--accent-light)",
                  fontSize:       13,
                  textDecoration: "none",
                  fontWeight:     500,
                }}
              >
                {siteUrl}
              </a>
            ) : (
              <span style={{ color: "var(--muted)", fontSize: 13 }}>
                Site is being built — check back soon
              </span>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div
          style={{
            display:             "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap:                 16,
            marginBottom:        20,
          }}
        >
          {/* Site score */}
          <div
            style={{
              background:   "var(--surface)",
              border:       "1px solid var(--border)",
              borderRadius: 12,
              padding:      "18px 20px",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
              Site Performance
            </div>
            {lead.site_score != null ? (
              <>
                <div
                  style={{
                    fontSize:      28,
                    fontWeight:    800,
                    letterSpacing: "-0.04em",
                    color:
                      lead.site_score >= 70
                        ? "var(--success)"
                        : lead.site_score >= 50
                        ? "var(--warning)"
                        : "var(--error)",
                    lineHeight:    1,
                    marginBottom:  8,
                  }}
                >
                  {lead.site_score}
                  <span style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)" }}>/100</span>
                </div>
                <div
                  style={{
                    height:         5,
                    borderRadius:   3,
                    background:     "var(--border-2)",
                    overflow:       "hidden",
                  }}
                >
                  <div
                    style={{
                      height:       "100%",
                      width:        `${lead.site_score}%`,
                      background:
                        lead.site_score >= 70
                          ? "var(--success)"
                          : lead.site_score >= 50
                          ? "var(--warning)"
                          : "var(--error)",
                      borderRadius: 3,
                      transition:   "width 0.4s ease",
                    }}
                  />
                </div>
              </>
            ) : (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                Being measured…
              </div>
            )}
          </div>

          {/* Google rating */}
          <div
            style={{
              background:   "var(--surface)",
              border:       "1px solid var(--border)",
              borderRadius: 12,
              padding:      "18px 20px",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
              Google Reviews
            </div>
            {lead.rating != null ? (
              <>
                <div
                  style={{
                    display:     "flex",
                    alignItems:  "baseline",
                    gap:         6,
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize:      28,
                      fontWeight:    800,
                      letterSpacing: "-0.04em",
                      color:         "var(--warning)",
                      lineHeight:    1,
                    }}
                  >
                    {lead.rating}
                  </span>
                  <Star size={16} color="var(--warning)" fill="var(--warning)" />
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {lead.review_count ?? 0} reviews
                </div>
              </>
            ) : (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>No data yet</div>
            )}
          </div>

          {/* Account / plan */}
          <div
            style={{
              background:   "var(--surface)",
              border:       "1px solid var(--border)",
              borderRadius: 12,
              padding:      "18px 20px",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
              Your Plan
            </div>
            <div
              style={{
                fontSize:      20,
                fontWeight:    800,
                color:         planInfo.color,
                lineHeight:    1,
                marginBottom:  6,
                letterSpacing: "-0.02em",
              }}
            >
              {planInfo.label}
            </div>
            <div style={{ fontSize: 12, color: lead.paid ? "var(--paid)" : "var(--warning)" }}>
              {lead.paid ? "✓ Active" : "Pending payment"}
            </div>
          </div>
        </div>

        {/* Multi-location panel (Scale only) */}
        {isMultiLocation && (
          <div
            style={{
              background:   "var(--surface)",
              border:       "1px solid var(--border)",
              borderRadius: 14,
              padding:      "24px 28px",
              marginBottom: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <MapPin size={16} color="var(--accent-light)" />
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                All Locations ({locations.length})
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {locations.map((loc) => {
                const locStatus = STATUS_LABEL[loc.status] ?? { label: loc.status, color: "var(--muted)", icon: Clock }
                const LocIcon = locStatus.icon
                const locUrl = loc.cloudflare_url ?? loc.vercel_url
                return (
                  <div
                    key={loc.id}
                    style={{
                      background:   "var(--surface-2)",
                      border:       "1px solid var(--border)",
                      borderRadius: 10,
                      padding:      "14px 18px",
                      display:      "flex",
                      alignItems:   "center",
                      justifyContent: "space-between",
                      gap:          12,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{loc.name}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                        {loc.city}, {loc.state}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <LocIcon size={13} color={locStatus.color} />
                        <span style={{ fontSize: 12, color: locStatus.color, fontWeight: 600 }}>{locStatus.label}</span>
                      </div>
                      {locUrl && (
                        <a
                          href={locUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: "flex", alignItems: "center", gap: 4,
                            color: "var(--accent-light)", fontSize: 12,
                            textDecoration: "none", fontWeight: 600,
                          }}
                        >
                          <Globe size={12} />
                          View
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Vapi voice reception info (Scale only) */}
        {lead.vapi_phone_number && (
          <div
            style={{
              background:   "rgba(16,185,129,0.06)",
              border:       "1px solid rgba(16,185,129,0.2)",
              borderRadius: 14,
              padding:      "20px 24px",
              marginBottom: 20,
              display:      "flex",
              alignItems:   "center",
              gap:          14,
            }}
          >
            <div style={{ fontSize: 24 }}>📞</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#10b981", marginBottom: 2 }}>
                AI Voice Reception Active
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                Dedicated number: <strong style={{ color: "var(--text)" }}>{lead.vapi_phone_number}</strong>
                {" · "}Calls answered 24/7 by AI
              </div>
            </div>
          </div>
        )}

        {/* Change request */}
        <ChangeRequestForm leadId={lead.id} email={email} />
      </div>
    </div>
  )
}

function ChangeRequestForm({ leadId, email }: { leadId: string; email: string }) {
  return (
    <div
      style={{
        background:   "var(--surface)",
        border:       "1px solid var(--border)",
        borderRadius: 14,
        padding:      "24px 28px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <MessageSquare size={16} color="var(--accent-light)" />
        <span
          style={{
            fontSize:   14,
            fontWeight: 700,
            color:      "var(--text)",
          }}
        >
          Request a Change
        </span>
      </div>
      <ChangeRequestFormClient leadId={leadId} email={email} />
    </div>
  )
}

// Inline client component for the form
import { ChangeRequestFormClient } from "@/components/change-request-form"
