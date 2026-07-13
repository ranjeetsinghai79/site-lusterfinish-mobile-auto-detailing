import { ScrollTrigger } from "./gsap-init"
import type gsap from "gsap"

type Killable =
  | gsap.core.Tween
  | gsap.core.Timeline
  | ScrollTrigger
  | { kill: () => void }

export function createScope() {
  const items: Killable[] = []
  return {
    add<T extends Killable>(item: T): T {
      items.push(item)
      return item
    },
    kill() {
      for (const item of items) {
        try {
          item.kill()
        } catch {
          // ignore — item may already be killed
        }
      }
      items.length = 0
    },
  }
}

export type Scope = ReturnType<typeof createScope>
