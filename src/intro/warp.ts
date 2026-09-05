import { CONFIG, PALETTE } from './config'

/*
 * The entry effect: white motion lines streaking outward past the viewer as the
 * ball is pulled into Earth, replacing the flat white-out that was here before.
 *
 * The lines carry the character, but a white wash underneath still ramps up over
 * the last sliver of the flight. That wash is load-bearing rather than
 * decorative — it is what covers the swap from the ASCII canvas to the hero, and
 * removing it would mean reinstating a crossfade.
 *
 * Fades are owned here rather than by a CSS class on the host. Both moments that
 * need one — settling after the landing, and bailing out when the reader breaks
 * orbit — happen when the intro's frame loop is either stopped or about to
 * report zero, so a CSS transition on the host had nothing to interpolate from.
 * A self-driven fade works in both cases.
 */

/**
 * The four directional glyphs, indexed by angular sector — the same set and the
 * same idea as the ASCII renderer's edge pass, so a streak is built from the
 * characters the rest of the scene would have used to draw a line at that angle.
 *
 * Ordered for canvas coordinates, where y grows downward: a sector-1 streak runs
 * right-and-down, which reads as a backslash rather than a forward slash.
 */
const GLYPHS = ['-', '\\', '|', '/'] as const

const FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace'

interface Line {
  angle: number
  glyph: string
  /** Where the streak starts, as a fraction of the screen radius. */
  radius: number
  /** Length in characters, not pixels — these are glyph runs. */
  glyphs: number
  /** Font size. Stands in for stroke weight now that these are characters. */
  size: number
  alpha: number
  /** Per-line offset so they do not all pulse together. */
  phase: number
  /** Per-line drift rate, so the field does not slide as one rigid body. */
  speed: number
}

export interface Warp {
  setSize(width: number, height: number): void
  /** @param intensity 0..1 line strength. @param wash 0..1 white cover. */
  render(now: number, intensity: number, wash: number): void
  /** Decay whatever is on screen to nothing over `ms`, ignoring render until done. */
  fadeOut(ms: number): void
  dispose(): void
}

function buildLines(count: number): Line[] {
  const { sizeMin, sizeMax } = CONFIG.warp
  const lines: Line[] = []

  for (let i = 0; i < count; i++) {
    // Even angular spread with jitter. The jitter is wider than it was for
    // strokes: with far fewer streaks, a near-perfect fan reads as a starburst
    // ornament rather than motion.
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4

    // Pick the glyph whose orientation is closest to the streak's own angle,
    // folding the angle into a half-turn first — a character has no head or tail.
    const sector = Math.round((((angle % Math.PI) + Math.PI) % Math.PI) / Math.PI * 4) % 4

    lines.push({
      angle,
      glyph: GLYPHS[sector],
      radius: 0.06 + Math.random() * 0.94,
      // Minimum 4: a two-character run reads as a speck of debris rather than a
      // streak, and with the count this low every streak has to carry its weight.
      glyphs: 4 + Math.floor(Math.random() * 10),
      size: sizeMin + Math.random() * (sizeMax - sizeMin),
      alpha: 0.4 + Math.random() * 0.6,
      phase: Math.random(),
      speed: 0.6 + Math.random() * 0.9,
    })
  }
  return lines
}

export function createWarp(canvas: HTMLCanvasElement): Warp {
  const context = canvas.getContext('2d')
  if (!context) {
    return { setSize() {}, render() {}, fadeOut() {}, dispose() {} }
  }
  const ctx = context

  const lines = buildLines(CONFIG.warp.lines)
  /*
   * The cover the streaks resolve into. Void, not pale: it used to blow out to
   * white, which read as a camera flash rather than an arrival. Darkening to the
   * page's own background lands the same masking as a dip to black — and because
   * it is the colour everything else already sits on, the hero fades up out of it
   * instead of out of a bright frame that was never part of the scene.
   */
  const washColour = PALETTE.void

  let width = 1
  let height = 1
  let ratio = 1

  let lastIntensity = 0
  let lastWash = 0

  let fading = false
  let fadeStart = 0
  let fadeMs = 1
  let fadeFromIntensity = 0
  let fadeFromWash = 0
  let fadeRaf = 0

  function setSize(cssWidth: number, cssHeight: number): void {
    ratio = Math.min(window.devicePixelRatio, 2)
    width = cssWidth
    height = cssHeight
    canvas.width = Math.round(cssWidth * ratio)
    canvas.height = Math.round(cssHeight * ratio)
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`
  }

  function paint(now: number, intensity: number, wash: number): void {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, width, height)
    lastIntensity = intensity
    lastWash = wash

    if (intensity <= 0.001 && wash <= 0.001) return

    const cx = width / 2
    const cy = height / 2
    const maxRadius = Math.hypot(cx, cy)

    // Gentle ramp. A hard one (1.6) kept the field near-invisible for most of the
    // band — measured 0.002 mean alpha at a third of the way in — so the streaks
    // never registered before the wash took over and it read as a plain flash.
    const stretch = Math.pow(intensity, 1.15)
    const drift = now * 0.00075

    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    for (const line of lines) {
      // Slide outward over time as well as with intensity, so the field reads as
      // moving rather than merely growing. Per-line speed staggers the drift.
      const travel = (line.radius + drift * line.speed + line.phase) % 1
      // Floor the start radius. Every angle converges on the focus, so without
      // one the glyphs of every streak near travel 0 stack into a blob there.
      const inner = (0.04 + travel * (0.32 + 0.68 * (1 - stretch * 0.55))) * maxRadius

      const cos = Math.cos(line.angle)
      const sin = Math.sin(line.angle)

      // Both the character size and the run length grow with intensity, so a
      // streak thickens and lengthens as it is drawn in rather than just fading up.
      const size = line.size * (0.7 + 0.5 * stretch)
      const count = Math.max(1, Math.round(line.glyphs * (0.25 + 0.75 * stretch)))
      const step = size * 0.62
      ctx.font = `${size.toFixed(1)}px ${FONT}`

      // Faint at the centre, strongest toward the edge — matches how optic flow
      // actually behaves and stops the middle turning into a bright knot.
      // sqrt, not linear: alpha has to arrive well before full intensity or the
      // streaks only exist during the sliver where the wash already hides them.
      // Steeper centre falloff than the stroke version used: characters have real
      // area, so the residual overlap at the focus reads as a bright smudge at an
      // alpha where thin strokes were still unobtrusive.
      const base = line.alpha * Math.sqrt(intensity) * (0.12 + travel * 1.4)

      for (let i = 0; i < count; i++) {
        const distance = inner + i * step
        // Taper along the run so a streak trails off instead of ending on a hard
        // character — the stroke version got this free from its round line cap.
        const taper = 1 - (i / count) * 0.65
        ctx.globalAlpha = Math.min(base * taper, 1)
        ctx.fillText(line.glyph, cx + cos * distance, cy + sin * distance)
      }
    }

    if (wash > 0.001) {
      ctx.globalAlpha = Math.min(wash, 1)
      ctx.fillStyle = washColour
      ctx.fillRect(0, 0, width, height)
    }
    ctx.globalAlpha = 1
  }

  function step(now: number): void {
    const t = Math.min((now - fadeStart) / fadeMs, 1)
    const eased = 1 - Math.pow(1 - t, 2)
    paint(now, fadeFromIntensity * (1 - eased), fadeFromWash * (1 - eased))
    if (t < 1) {
      fadeRaf = requestAnimationFrame(step)
    } else {
      fading = false
      paint(now, 0, 0)
    }
  }

  return {
    setSize,

    render(now, intensity, wash) {
      // A fade owns the surface until it finishes. The intro's loop keeps calling
      // in with progress-derived values during the bail-out, and honouring them
      // would cut the fade off at its first frame.
      if (fading) return
      paint(now, intensity, wash)
    },

    fadeOut(ms) {
      if (lastIntensity <= 0.001 && lastWash <= 0.001) return
      cancelAnimationFrame(fadeRaf)
      fading = true
      fadeMs = Math.max(ms, 1)
      fadeStart = performance.now()
      fadeFromIntensity = lastIntensity
      fadeFromWash = lastWash
      fadeRaf = requestAnimationFrame(step)
    },

    dispose() {
      cancelAnimationFrame(fadeRaf)
    },
  }
}
