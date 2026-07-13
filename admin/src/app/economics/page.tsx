export const runtime = 'edge'
import { Calculator, DollarSign, Gauge, ShieldCheck, TrendingUp } from "lucide-react"

export const dynamic = "force-dynamic"

const tiers = [
  {
    name: "Free Audit",
    price: 0,
    cogs: 1.5,
    target: "Lead magnet",
    included: "Audit, visibility score, competitor report, revenue estimate",
    note: "Loss leader. Keep lightweight and automated.",
  },
  {
    name: "Starter",
    price: 49,
    cogs: 8,
    target: "Try-it-now adoption",
    included: "Website, hosting, AI chat, lead capture CRM, reviews dashboard",
    note: "High margin only if support is minimal.",
  },
  {
    name: "Growth",
    price: 149,
    cogs: 32,
    target: "Best seller",
    included: "AI reception, SMS/email follow-up, booking, reviews, analytics, SEO/blog improvements",
    note: "Best win-win tier if usage caps are enforced.",
  },
  {
    name: "Pro",
    price: 349,
    cogs: 92,
    target: "Done-for-you growth",
    included: "Voice AI, social/image/carousel automation, ad campaign drafts, competitor monitoring, reports",
    note: "Ad spend is pass-through, not included.",
  },
  {
    name: "Scale",
    price: 699,
    cogs: 210,
    target: "Multi-location / higher volume",
    included: "More call volume, more messages, multi-location reporting, advanced automations",
    note: "Needs usage-based overage protection.",
  },
]

const assumptions = [
  "Ad spend is always paid by the client or billed as pass-through.",
  "Voice minutes, SMS, and image generation need monthly caps per tier.",
  "Human support time is the real margin risk; keep onboarding scripted.",
  "Starter should not include live voice AI unless usage is tightly capped.",
  "Pro/Scale should require approval before campaign launch or budget changes.",
]

export default function EconomicsPage() {
  return (
    <div style={{ padding: "32px 36px", maxWidth: 1180 }}>
      <div style={{ marginBottom: 26 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)" }}>
          Pricing & Unit Economics
        </h1>
        <p style={{ color: "var(--text-2)", fontSize: 13, marginTop: 4 }}>
          Launch pricing for AI Front Office. COGS are conservative operating estimates before labor and payment fees.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 26 }}>
        <TopCard icon={<DollarSign size={16} />} label="Best Starter Price" value="$49/mo" color="var(--success)" />
        <TopCard icon={<TrendingUp size={16} />} label="Best Seller Target" value="$149/mo" color="var(--accent-light)" />
        <TopCard icon={<Gauge size={16} />} label="Pro Gross Margin" value="74%" color="var(--paid)" />
        <TopCard icon={<ShieldCheck size={16} />} label="Rule" value="Cap Usage" color="var(--warning)" />
      </div>

      <section style={panel}>
        <div style={panelHeader}>Tier Profitability</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
            <thead>
              <tr>
                {["Tier", "Price", "Est. COGS", "Gross Profit", "Margin", "Target", "Included"].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => {
                const profit = tier.price - tier.cogs
                const margin = tier.price > 0 ? Math.round((profit / tier.price) * 100) : null
                return (
                  <tr key={tier.name}>
                    <td style={tdStrong}>{tier.name}</td>
                    <td style={td}>${tier.price}</td>
                    <td style={td}>${tier.cogs.toFixed(0)}</td>
                    <td style={{ ...td, color: profit >= 0 ? "var(--success)" : "var(--error)", fontWeight: 750 }}>
                      {profit >= 0 ? `$${profit.toFixed(0)}` : `-$${Math.abs(profit).toFixed(0)}`}
                    </td>
                    <td style={td}>{margin === null ? "Lead cost" : `${margin}%`}</td>
                    <td style={td}>{tier.target}</td>
                    <td style={{ ...td, color: "var(--text-2)", lineHeight: 1.45 }}>{tier.included}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 18 }}>
        <section style={{ ...panel, padding: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
            <Calculator size={16} color="var(--accent-light)" />
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>Win-Win Positioning</div>
          </div>
          <p style={{ color: "var(--text-2)", fontSize: 13, lineHeight: 1.65 }}>
            The offer should be “Hire an AI Business Manager” or “Hire your AI Front Office,” not “marketing SaaS.”
            The client buys outcomes: answered calls, captured leads, follow-up, bookings, reviews, content, and lead campaigns.
          </p>
        </section>

        <section style={{ ...panel, padding: 22 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", marginBottom: 12 }}>Guardrails</div>
          <div style={{ display: "grid", gap: 8 }}>
            {assumptions.map((a) => (
              <div key={a} style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.45 }}>
                <span style={{ color: "var(--warning)", marginRight: 7 }}>•</span>{a}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function TopCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div style={{ ...panel, padding: "15px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color, marginBottom: 10 }}>
        {icon}
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      </div>
      <div style={{ fontSize: 25, fontWeight: 850, color: "var(--text)", letterSpacing: "-0.04em" }}>{value}</div>
    </div>
  )
}

const panel: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  overflow: "hidden",
}

const panelHeader: React.CSSProperties = {
  padding: "13px 18px",
  borderBottom: "1px solid var(--border)",
  fontSize: 11,
  fontWeight: 800,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
}

const th: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  padding: "12px 14px",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
}

const td: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--text)",
  padding: "14px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "top",
}

const tdStrong: React.CSSProperties = {
  ...td,
  fontWeight: 800,
  color: "var(--text)",
}
