"use client"

import { useEffect, useRef } from "react"
import { gsap } from "@core/web"
import type { SiteConfig } from "@core/web/types"

interface Props { config: SiteConfig }

function StarRow({ n }: { n: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          width="14" height="14"
          viewBox="0 0 24 24"
          fill={i < n ? "var(--brand-accent)" : "none"}
          stroke="var(--brand-accent)"
          strokeWidth="1.5"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      ))}
    </div>
  )
}

export default function HvacReviews({ config }: Props) {
  const testimonials = config.testimonials ?? []
  const sectionRef   = useRef<HTMLElement>(null)
  const headRef      = useRef<HTMLDivElement>(null)
  const trackRef     = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!headRef.current || !trackRef.current) return

    gsap.from(headRef.current, {
      opacity: 0, y: 30, duration: 0.7, ease: "power3.out",
      scrollTrigger: { trigger: headRef.current, start: "top 85%", once: true },
    })

    const cards = trackRef.current.querySelectorAll<HTMLElement>(".review-card")
    gsap.from(cards, {
      opacity: 0, x: 60,
      stagger: 0.1, duration: 0.75, ease: "power3.out",
      scrollTrigger: { trigger: trackRef.current, start: "top 85%", once: true },
    })
  }, [])

  // Duplicate for scroll overflow visual richness
  const extended = testimonials.length < 3
    ? [...testimonials, ...testimonials, ...testimonials]
    : testimonials

  return (
    <section
      ref={sectionRef}
      id="reviews"
      className="relative py-24 lg:py-32 overflow-hidden"
      style={{ background: "var(--brand-bg-2)" }}
    >
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(56,189,248,0.2), transparent)" }}
      />

      {/* Large ambient quote mark */}
      <div
        className="absolute right-12 top-12 select-none pointer-events-none font-display font-700"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "20rem",
          lineHeight: 1,
          color: "rgba(249,115,22,0.04)",
        }}
      >
        "
      </div>

      <div className="relative max-w-[1400px] mx-auto px-6 lg:px-12 xl:px-16">
        {/* Heading */}
        <div ref={headRef} className="mb-12 flex flex-col sm:flex-row sm:items-end justify-between gap-6">
          <div>
            <p className="section-label mb-3">Customer Reviews</p>
            <h2
              className="font-display font-700 uppercase"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(2rem, 5vw, 4rem)",
                lineHeight: 0.95,
                color: "var(--brand-fg)",
                letterSpacing: "-0.02em",
              }}
            >
              Real People.
              <br />
              <span style={{ color: "var(--brand-accent)" }}>Real Results.</span>
            </h2>
          </div>

          {/* Summary block */}
          <div
            className="flex items-center gap-5 px-6 py-4 rounded-xl shrink-0"
            style={{
              background: "rgba(249,115,22,0.08)",
              border: "1px solid rgba(249,115,22,0.2)",
            }}
          >
            <div className="text-center">
              <div
                className="font-display font-700 tabular-nums"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "2.5rem",
                  lineHeight: 1,
                  color: "var(--brand-accent)",
                  textShadow: "0 0 20px rgba(249,115,22,0.4)",
                }}
              >
                {config.business.google_rating}
              </div>
              <StarRow n={5} />
            </div>
            <div
              className="w-px self-stretch"
              style={{ background: "rgba(249,115,22,0.2)" }}
            />
            <div className="text-left">
              <p
                className="font-display font-700"
                style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", color: "var(--brand-fg)" }}
              >
                {config.business.review_count}+
              </p>
              <p
                style={{ fontFamily: "var(--font-body)", fontSize: "0.8rem", color: "var(--brand-fg-muted)" }}
              >
                Google Reviews
              </p>
            </div>
          </div>
        </div>

        {/* Review cards track */}
        <div
          ref={trackRef}
          className="grid gap-5"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
        >
          {extended.map((t, i) => (
            <div key={i} className="review-card hover-lift p-7 flex flex-col gap-4">
              {/* Quote icon */}
              <div
                style={{
                  width: 28, height: 28,
                  color: "var(--brand-accent)",
                  opacity: 0.6,
                  flexShrink: 0,
                }}
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/>
                </svg>
              </div>

              {/* Stars */}
              <StarRow n={t.stars} />

              {/* Text */}
              <p
                className="flex-1"
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "0.95rem",
                  lineHeight: 1.75,
                  color: "rgba(248,250,252,0.8)",
                  fontStyle: "italic",
                }}
              >
                "{t.text}"
              </p>

              {/* Author */}
              <div className="flex items-center gap-3 pt-2">
                {/* Avatar */}
                {t.avatar ? (
                  <img
                    src={t.avatar}
                    alt={t.name}
                    width={40}
                    height={40}
                    className="rounded-full"
                    style={{ border: "2px solid rgba(249,115,22,0.3)" }}
                  />
                ) : (
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center font-display font-700 text-sm"
                    style={{
                      background: "rgba(249,115,22,0.15)",
                      border: "2px solid rgba(249,115,22,0.3)",
                      color: "#F97316",
                      fontFamily: "var(--font-display)",
                    }}
                  >
                    {t.name.charAt(0)}
                  </div>
                )}
                <div>
                  <p
                    className="font-display font-600"
                    style={{ fontFamily: "var(--font-display)", fontSize: "0.95rem", color: "var(--brand-fg)" }}
                  >
                    {t.name}
                  </p>
                  {t.location && (
                    <p style={{ fontFamily: "var(--font-body)", fontSize: "0.78rem", color: "var(--brand-fg-subtle)" }}>
                      {t.location}
                    </p>
                  )}
                </div>
                {/* Google G icon */}
                <div className="ml-auto">
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-10 text-center">
          <p
            style={{ fontFamily: "var(--font-body)", fontSize: "0.9rem", color: "var(--brand-fg-muted)", marginBottom: 16 }}
          >
            Join {config.business.review_count}+ satisfied customers across Tracy &amp; the Central Valley
          </p>
          <a
            href={config.business.phoneHref}
            className="btn-primary inline-flex items-center gap-3 px-8 py-4"
            style={{ fontSize: "0.95rem" }}
          >
            Schedule Your Service
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </a>
        </div>
      </div>
    </section>
  )
}
