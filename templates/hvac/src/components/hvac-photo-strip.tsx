"use client"

import { useEffect, useRef } from "react"
import { gsap } from "@core/web"

const PHOTOS = [
  { src: "/hero-2.jpg", label: "AC Installation", sub: "Same-day service" },
  { src: "/hero-3.jpg", label: "Furnace Repair",  sub: "NATE-certified tech" },
  { src: "/hero-4.jpg", label: "Emergency Call",  sub: "45-min response" },
]

export default function HvacPhotoStrip() {
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!rowRef.current) return
    const items = rowRef.current.querySelectorAll<HTMLElement>(".photo-item")
    gsap.from(items, {
      opacity: 0, scale: 0.94, y: 32,
      stagger: 0.12, duration: 0.75, ease: "power3.out",
      scrollTrigger: { trigger: rowRef.current, start: "top 85%", once: true },
    })
  }, [])

  return (
    <div
      ref={rowRef}
      className="max-w-[1400px] mx-auto px-6 lg:px-12 xl:px-16 py-10 grid grid-cols-3 gap-4"
    >
      {PHOTOS.map(({ src, label, sub }) => (
        <div
          key={label}
          className="photo-item relative overflow-hidden rounded-xl"
          style={{ aspectRatio: "4/3" }}
        >
          <img
            src={src}
            alt={label}
            className="w-full h-full object-cover object-center"
            style={{
              transition: "transform 0.6s cubic-bezier(0.25,0.46,0.45,0.94)",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLImageElement).style.transform = "scale(1.05)" }}
            onMouseLeave={e => { (e.currentTarget as HTMLImageElement).style.transform = "scale(1)" }}
          />
          {/* Gradient overlay */}
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(180deg, transparent 40%, rgba(5,10,15,0.85) 100%)",
            }}
          />
          {/* Label */}
          <div className="absolute bottom-0 left-0 p-4">
            <p
              className="font-display font-700 uppercase"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "1rem",
                color: "#fff",
                letterSpacing: "-0.01em",
                lineHeight: 1.1,
              }}
            >
              {label}
            </p>
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.75rem",
                color: "rgba(249,115,22,0.9)",
                marginTop: 2,
              }}
            >
              {sub}
            </p>
          </div>
          {/* Top-right badge */}
          <div
            className="absolute top-3 right-3 w-2 h-2 rounded-full"
            style={{ background: "#F97316", boxShadow: "0 0 8px rgba(249,115,22,0.7)" }}
          />
        </div>
      ))}
    </div>
  )
}
