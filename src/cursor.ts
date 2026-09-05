/*
 * The cursor: an oversized pixel arrow that leaves an ASCII wake, and swaps to a
 * pixel hand over anything clickable.
 *
 * Both halves are the same idea — an image made of discrete cells rather than
 * smooth curves — which is what the whole flight is. The arrow is the shape
 * every reader already knows, rebuilt at a resolution coarse enough that you can
 * count the pixels; the wake is the glyphs the ASCII renderer would have used,
 * dropped along the path travelled.
 *
 * The pair does a job neither half does alone: the arrow gives the pointer a
 * precise *place*, the wake gives it *motion*.
 *
 * Two things follow from it being pixel art, and both are load-bearing:
 *
 * - Nothing is smoothed, eased, or drawn at a fractional coordinate. An eased
 *   cursor reads as input lag no matter how pretty it is, and a sprite on a
 *   half-pixel is a blurred sprite. Position is rounded and exact, every frame.
 * - The dark outline around the fill is not decoration. It is the reason the
 *   cursor survives the project banners, which are mostly white — the same
 *   reason every OS cursor has had one since they were 16x16.
 */

import { PALETTE } from './intro/config'

const FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/**
 * The ASCII renderer's density ramp minus its blank first cell — a trail cannot
 * emit nothing. Faster travel picks from the dense end, so the wake thickens
 * with speed the same way the scene's lit surfaces do with luminance.
 */
const RAMP = '.:-=+*#%@'

/**
 * The arrow, one character per cell: `#` outline, `.` fill, space transparent.
 *
 * Deliberately the canonical shape rather than an invented one. A cursor is the
 * one element on a page with no affordance to learn from — it has to be legible
 * at a glance and in peripheral vision, and every departure from the arrow
 * everyone already knows is paid for in hesitation.
 *
 * The tip is cell (0,0), so the hotspot needs no offset.
 *
 * The tail steps sideways every *other* row. A full cell per row is a 45° slant
 * — the same angle as the head's right edge — which bends the silhouette away
 * from the arrow's axis and reads as a checkmark rather than a stem. Real
 * pointers slant their tail far less than their head; this is ~27° off vertical.
 *
 * The head's bottom edge still overhangs the tail, by two cells. That shelf is
 * what separates head from tail — closing it flush merges the two into one long
 * wedge and the arrowhead stops reading as an arrowhead. Three cells of it, over
 * a taller head, was the shelf that looked broken; two is a bottom edge.
 *
 * Tail fill is three cells against a nine-cell head. At four it was 44% of the
 * head's width and read as a second slab hanging off it rather than a stem —
 * real pointers keep the tail nearer a third of the head, which is what gives
 * the silhouette its taper.
 */
const ARROW = [
  '#            ',
  '##           ',
  '#.#          ',
  '#..#         ',
  '#...#        ',
  '#....#       ',
  '#.....#      ',
  '#......#     ',
  '#.......#    ',
  '#........#   ',
  '#.........#  ',
  '#.......###  ',
  '#..#...#     ',
  '#.# #...#    ',
  '##  #...#    ',
  '     #...#   ',
  '     #...#   ',
  '      #...#  ',
  '      #####  ',
]

/**
 * The pointing hand, shown over anything clickable.
 *
 * A recolour alone was doing this job before, and a colour swap is the weakest
 * hover signal there is: it is invisible to the reader who is not already
 * looking at the pointer, and on a page where the accent blue is everywhere it
 * is not even distinctive. A shape change reads in peripheral vision.
 *
 * One raised finger over a rounded fist, with no separated knuckles. The real
 * OS hand splits three fingers, but those splits are one cell wide here and at
 * this size they close up into noise — the silhouette is what has to carry it.
 *
 * The hotspot is the fingertip rather than cell (0,0), which is what the sprite
 * table's offset is for: pointing at a link with the heel of your hand is not
 * pointing at it.
 */
const HAND = [
  '   ##        ',
  '  #..#       ',
  '  #..#       ',
  '  #..#       ',
  '  #..#       ',
  '  #..#       ',
  '  #..######  ',
  '  #.......#  ',
  '  #.......#  ',
  ' #........#  ',
  '#.........#  ',
  '#.........#  ',
  '#.........#  ',
  ' #........#  ',
  ' #........#  ',
  '  #......#   ',
  '  #......#   ',
  '  ########   ',
]

/**
 * Size of one sprite cell in CSS pixels. The grids above are 13x19, roughly a
 * system arrow, so this doubles it to 26x38 — a shade bigger than the real thing,
 * which is enough to read as a deliberate object without becoming a thing the
 * reader has to steer around. Tripling it was the latter.
 *
 * Integer only. A fractional scale puts cell edges on half-pixels and the whole
 * point of the sprite — hard, countable squares — goes soft.
 */
const PIXEL = 2

/** Cells the sprite shifts down-right while the button is held. */
const PRESS_OFFSET = 1

interface Sprite {
  /** Horizontal runs of like cells: [col, row, span]. */
  outline: number[][]
  fill: number[][]
  /** Cell that sits on the reported pointer position. */
  hotspotCol: number
  hotspotRow: number
}

/**
 * Walk a grid once into horizontal runs of like cells.
 *
 * Neither sprite ever changes shape, so this runs at module load and every frame
 * after is a short list of fillRects rather than ~250 string lookups — the
 * cursor redraws on every pointer event, which is the one place on this page
 * where per-frame work is genuinely hot.
 */
function compileSprite(cells: string[], hotspotCol: number, hotspotRow: number): Sprite {
  const outline: number[][] = []
  const fill: number[][] = []

  for (let row = 0; row < cells.length; row++) {
    const line = cells[row]
    let col = 0
    while (col < line.length) {
      const char = line[col]
      let span = 1
      while (col + span < line.length && line[col + span] === char) span++
      if (char === '#') outline.push([col, row, span])
      else if (char === '.') fill.push([col, row, span])
      col += span
    }
  }

  return { outline, fill, hotspotCol, hotspotRow }
}

const SPRITES = {
  // The arrow's tip is cell (0,0), so it needs no hotspot offset at all.
  arrow: compileSprite(ARROW, 0, 0),
  // The fingertip spans cells 3 and 4; 3 is the side the finger points from.
  hand: compileSprite(HAND, 3, 0),
}

const TRAIL = {
  /** Pointer travel between emitted glyphs, in px. Sets the wake's spacing. */
  step: 11,
  lifeMs: 520,
  sizeMin: 8.5,
  sizeMax: 15,
  /** Speed, in px/ms, at which glyphs reach the dense end of the ramp. */
  speedForFullRamp: 2.2,
  /** How far a glyph wanders over its life. Small — this is decay, not drift. */
  drift: 6,
  /**
   * Ceiling on live glyphs. At the emit step above, a fling across a wide screen
   * can outrun the decay; without a cap the wake turns into a solid stroke.
   */
  max: 64,
}

/** Stop the frame loop this long after the last thing that needed one. */
const IDLE_STOP_MS = 350

/** What the sprite switches to the hand over. */
const TARGET_SELECTOR = 'a, button, [role="button"], [data-cursor-target]'

interface Glyph {
  x: number
  y: number
  char: string
  size: number
  born: number
  /** Direction of the glyph's own decay drift. */
  driftX: number
  driftY: number
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

export function initCursor(): void {
  const layer = document.getElementById('cursor-layer')
  const surface = layer?.querySelector('canvas')
  if (!layer || !(surface instanceof HTMLCanvasElement)) return
  const host = layer
  const canvas = surface

  /*
   * Bail on anything without a real pointer. Hiding the system cursor on a
   * touch device costs nothing visually — there is none — but the reticle would
   * be stranded wherever the last tap landed, and `pointer: coarse` also covers
   * the case where a mouse is present but hover is unreliable.
   */
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

  const context = canvas.getContext('2d')
  if (!context) return
  const ctx = context

  /* The wake is motion decoration and nothing else, so it is the part that goes
     when motion is unwelcome. The arrow stays: it is the pointer. */
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)')

  let width = 1
  let height = 1
  let ratio = 1

  /** Pointer position. The sprite's tip is drawn here, rounded and exact. */
  let pointerX = -100
  let pointerY = -100

  /** Last point that emitted a glyph, and when — together these give speed. */
  let emitX = -100
  let emitY = -100
  let emitAt = 0

  /*
   * Both are booleans, not eased scalars. The sprite has three states and swaps
   * between them on the frame the input changes: easing a pixel cursor's colour
   * would put it in a blend that is in none of its three palettes, and easing
   * its position would blur it.
   */
  let hovering = false
  let pressing = false

  let visible = false
  const glyphs: Glyph[] = []

  let raf = 0
  let lastActivity = 0

  function resize(): void {
    ratio = Math.min(window.devicePixelRatio, 2)
    width = window.innerWidth
    height = window.innerHeight
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
  }

  /**
   * Lay glyphs along the segment just travelled rather than one per event.
   * Pointer events arrive at the display's rate but a fling covers far more than
   * one step between two of them, so emitting per event would leave the wake
   * sparse exactly when the motion is fastest — the opposite of what it is for.
   */
  function emitTrail(now: number): void {
    if (calm.matches) return

    const dx = pointerX - emitX
    const dy = pointerY - emitY
    const distance = Math.hypot(dx, dy)
    if (distance < TRAIL.step) return

    const elapsed = Math.max(now - emitAt, 1)
    const speed = distance / elapsed
    const heat = Math.min(speed / TRAIL.speedForFullRamp, 1)

    // Dense end of the ramp for fast travel, sparse for a slow drag.
    const index = Math.min(Math.round(heat * (RAMP.length - 1)), RAMP.length - 1)
    const char = RAMP[index]
    const size = lerp(TRAIL.sizeMin, TRAIL.sizeMax, heat)

    const steps = Math.min(Math.floor(distance / TRAIL.step), TRAIL.max)
    for (let i = 1; i <= steps; i++) {
      const t = (i * TRAIL.step) / distance
      const angle = Math.random() * Math.PI * 2
      glyphs.push({
        x: emitX + dx * t,
        y: emitY + dy * t,
        char,
        size,
        born: now,
        driftX: Math.cos(angle) * TRAIL.drift,
        driftY: Math.sin(angle) * TRAIL.drift,
      })
    }

    if (glyphs.length > TRAIL.max) glyphs.splice(0, glyphs.length - TRAIL.max)

    emitX = pointerX
    emitY = pointerY
    emitAt = now
  }

  function drawTrail(now: number): void {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    for (let i = glyphs.length - 1; i >= 0; i--) {
      const glyph = glyphs[i]
      const age = (now - glyph.born) / TRAIL.lifeMs
      if (age >= 1) {
        glyphs.splice(i, 1)
        continue
      }

      // Cubic falloff. Linear left the whole wake at a readable grey for most of
      // its life, which reads as a smear that happens to end rather than a decay.
      const fade = (1 - age) ** 3

      ctx.globalAlpha = fade * 0.85
      ctx.font = `${(glyph.size * (0.75 + 0.25 * (1 - age))).toFixed(1)}px ${FONT}`

      const x = glyph.x + glyph.driftX * age
      const y = glyph.y + glyph.driftY * age

      // Same dark backing as the reticle, for the same reason: the wake crosses
      // the project banners too, and blue on near-white is not a colour.
      ctx.lineWidth = 2.5
      ctx.strokeStyle = 'rgba(7, 7, 15, 0.5)'
      ctx.strokeText(glyph.char, x, y)

      ctx.fillStyle = PALETTE.accent
      ctx.fillText(glyph.char, x, y)
    }

    ctx.globalAlpha = 1
  }

  function paintRuns(list: number[][], x: number, y: number): void {
    for (const [col, row, span] of list) {
      ctx.fillRect(x + col * PIXEL, y + row * PIXEL, span * PIXEL, PIXEL)
    }
  }

  function drawSprite(): void {
    /*
     * The shape itself is the hover state: arrow over the page, pointing hand
     * over anything clickable. Swapped on the frame the input changes, with no
     * transition — there is no halfway between two pixel grids that is not just
     * a blurred one, and the whole point of a shape signal is that it is instant.
     */
    const sprite = hovering ? SPRITES.hand : SPRITES.arrow

    /*
     * Hotspot-corrected, then rounded. The offset is in whole cells so the grid
     * stays aligned to the device pixel grid — a hotspot on a half-cell would
     * soften every edge of the sprite it is meant to position.
     */
    const shift = pressing ? PRESS_OFFSET * PIXEL : 0
    const x = Math.round(pointerX) - sprite.hotspotCol * PIXEL + shift
    const y = Math.round(pointerY) - sprite.hotspotRow * PIXEL + shift

    /*
     * Flat states, no blending. Pressing takes the fill to white and nudges the
     * whole sprite a cell down-right, which is the oldest button-press idiom
     * there is and costs a single integer. Hover does NOT recolour — the swap
     * to the hand shape is the whole signal; a blue hand over the page's blue
     * buttons read as the cursor changing sides.
     */
    ctx.fillStyle = PALETTE.void
    paintRuns(sprite.outline, x, y)

    ctx.fillStyle = pressing ? PALETTE.white : PALETTE.pale
    paintRuns(sprite.fill, x, y)
  }

  function frame(now: number): void {
    raf = 0
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, width, height)

    if (visible) {
      drawTrail(now)
      drawSprite()
    } else {
      glyphs.length = 0
    }

    /*
     * Idle out rather than holding a rAF forever. A cursor that pins a frame
     * loop at 60fps while the reader sits still is a real battery cost on a
     * page that is otherwise completely static once the flight is over.
     *
     * Only the wake can keep it alive now. The sprite itself has no animation to
     * settle — it is redrawn on the frame after an input and is then final —
     * so a still pointer over a still page costs exactly nothing.
     */
    if (glyphs.length > 0) lastActivity = now
    if (visible && now - lastActivity < IDLE_STOP_MS) wake()
  }

  function wake(): void {
    if (raf) return
    raf = requestAnimationFrame(frame)
  }

  function onMove(event: PointerEvent): void {
    const now = performance.now()

    if (!visible) {
      // Anchor the wake at the entry point. Without this the first segment is
      // measured from wherever the pointer left the window, and re-entering
      // paints a line of glyphs clean across the page.
      visible = true
      emitX = event.clientX
      emitY = event.clientY
      emitAt = now
      host.classList.add('is-visible')
    }

    pointerX = event.clientX
    pointerY = event.clientY
    emitTrail(now)

    const target = event.target
    hovering = target instanceof Element && target.closest(TARGET_SELECTOR) !== null

    lastActivity = now
    wake()
  }

  function onLeave(): void {
    visible = false
    hovering = false
    pressing = false
    host.classList.remove('is-visible')
    wake()
  }

  function setPress(down: boolean): void {
    pressing = down
    lastActivity = performance.now()
    wake()
  }

  resize()
  document.body.classList.add('has-custom-cursor')

  window.addEventListener('resize', resize)
  // On the window, not the document: pointermove on the document stops firing
  // over an <iframe> or a native scrollbar, which strands the reticle mid-page.
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerdown', () => setPress(true), { passive: true })
  window.addEventListener('pointerup', () => setPress(false), { passive: true })
  document.addEventListener('pointerleave', onLeave)
  // Covers tabbing away mid-drag, where no pointerup or pointerleave arrives.
  window.addEventListener('blur', onLeave)
}
