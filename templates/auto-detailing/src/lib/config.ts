import type { SiteConfig } from "@core/web/types"

export const config: SiteConfig = {
  business: {
    name: "LusterFinish Mobile Auto Detailing",
    tagline: "Restore Your Car's Showroom Shine.",
    phone: "(510) 760-0763",
    phoneHref: "tel:+15107600763",
    email: "info@lusterfinishdetailing.com",
    address: "318 Mercantile St, Lathrop, CA 95330, USA",
    city: "Lathrop",
    serviceAreas: ["Lathrop"],
    since: "2018",
    google_rating: "4.9",
    review_count: "96",
    emergency: false,
    theme: "clean",
    niche: "auto-detailing",
  },

  services: [
    { icon: "sparkles", title: "Ceramic Coating", desc: "Long-lasting protection and incredible gloss for your vehicle's paint.", urgent: false },
    { icon: "wrench", title: "Paint Correction", desc: "Remove swirls, scratches, and imperfections for a flawless finish.", urgent: false },
    { icon: "shield-check", title: "Full Detail Package", desc: "Comprehensive interior and exterior cleaning for a like-new car.", urgent: false },
    { icon: "home", title: "Interior Detail", desc: "Deep clean and sanitize your car's cabin, restoring freshness.", urgent: false },
    { icon: "shield-check", title: "PPF (Paint Protection Film)", desc: "Invisible film shields paint from chips, scratches, and road debris.", urgent: false },
    { icon: "sparkles", title: "Window Tinting", desc: "Enhance privacy, reduce heat, and protect your interior from UV rays.", urgent: false }
  ],

  testimonials: [
    { name: "Debbie D.", location: "Lathrop, CA", stars: 5, text: "I’m thrilled with the beautiful detail that Luster Finish did on my 5 year old car. It was it’s first detail and it looks like new inside and out! Five stars ⭐️ ⭐️⭐️⭐️" },
    { name: "Evan Johnson", location: "Lathrop, CA", stars: 5, text: "After reading all the great reviews I hired Jose and he did not disappoint! He came to my house and did a ceramic coating on my 3 year old 4Runner with 50K miles and on my brand new Mini Cooper S.  Jose was very professional and attentive and both cars turned out great.  The 4Runner looks new and I've already received compliments on it.  Excited to have the new coating to help keep the Mini looking showroom fresh. Jose also provided tons of advice on maintaining and keeping the cars clean and shiny, including recommendations on products to use.  Highly recommended!" },
    { name: "Benjamin Dale", location: "Lathrop, CA", stars: 5, text: "I bought my new (to me) truck a few months ago.  The dealership slapped on some wax and ArmorAll to shine it up.  It is 6 years old now with 85k miles.  The paint needed some attention.  It had swirls from the automatic style car washes.  The roof had some serious issues from prolonged inattention.  A hazy ugly spot on the quarter panel where someone had poorly tried to fill in a chip.  I asked for a quote online at around 8:30 pm.  Jose texted me within minutes and we started talking about what the truck needed.  He had availability the next morning and arrived sharply at 8am.  We talked about possible issues on the truck and the different packages before settling on the one we had previously texted about.  He didn't try to upsell me to something outside of my budget.  We actually talked for a while about a number of things before he got rolling.  His mobile detailing van is completely self sufficient.  He doesn't need to use your electricity or water.  About 3 and a half hours later he was done and I am extremely happy.  Swirls are gone.  Roof looks way better.  That poorly fixed chip is now barely noticeable.  The light wasn't the best when I took the photos, but trust me, it's way way better than it was.  I'm a fan of Jose and will be recommending him to anyone looking for some detailing work.  He even texted me the following day unprompted with some suggestions of products to use to keep the truck maintained after the detail.  Might need to have him do the interior next!" }
  ],

  trustBadges: [
    "Licensed & Insured",
    "5-Star Rated",
    "Mobile Service Available",
    "Open 7 Days a Week",
    "Premium Products Used",
    "Satisfaction Guaranteed"
  ],

  stats: [
    { value: 4.9, label: "Google Rating", suffix: "★", decimals: 1 },
    { value: 1000, label: "Jobs Done", suffix: "+", decimals: 0 },
    { value: 5, label: "Yrs Experience", suffix: "+", decimals: 0 }
  ],

  reasons: [
    { icon: "clock", title: "Fast Response", desc: "Quickly schedule your detailing service with our responsive team." },
    { icon: "dollar-sign", title: "Upfront Pricing", desc: "Clear, transparent pricing with no hidden fees or surprises." },
    { icon: "award", title: "Certified Pros", desc: "Our technicians are trained and certified in advanced detailing techniques." },
    { icon: "thumbs-up", title: "Satisfaction Guarantee", desc: "We ensure you're thrilled with your vehicle's transformation." },
    { icon: "phone", title: "Real Humans Answer", desc: "Speak directly with a detailing expert, not an automated system." },
    { icon: "truck", title: "Fully Equipped", desc: "Our mobile unit brings all necessary tools and premium products to you." }
  ],

  formServiceOptions: ["Ceramic Coating", "Paint Correction", "Full Detail Package", "Interior Detail", "PPF (Paint Protection Film)", "Window Tinting"]
}

// Backward-compat re-exports
export const BUSINESS = config.business
export const SERVICES = config.services!
export const TESTIMONIALS = config.testimonials!
export const TRUST_BADGES = config.trustBadges!