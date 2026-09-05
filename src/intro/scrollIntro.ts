import * as THREE from 'three'
import { CONFIG } from './config'
import { AsciiRenderer } from './asciiRenderer'
import { createSpaceScene } from './spaceScene'
import { createWarp } from './warp'

/*
 * Scroll orchestration. This is the part borrowed structurally from the
 * reference site: a tall empty spacer drives progress, the render target is
 * pinned, and the hero is held fixed at opacity 0 until a crossfade at the very
 * end hands the page back to normal document flow.
 */

interface Elements {
  stage: HTMLElement
  spacer: HTMLElement
  heroPin: HTMLElement
  progressBar: HTMLElement
  nudge: HTMLElement
  nudgeSwap: HTMLElement
  nudgeScroll: HTMLElement
  nudgeIncoming: HTMLElement
  nudgePercent: HTMLElement
  breakOrbit: HTMLButtonElement
  flash: HTMLElement
  warpCanvas: HTMLCanvasElement
}

function getElements(): Elements | null {
  const stage = document.getElementById('ascii-stage')
  const spacer = document.getElementById('intro-scroll')
  const heroPin = document.getElementById('hero-pin')
  const progressBar = document.getElementById('intro-progress-bar')
  const nudge = document.getElementById('scroll-nudge')
  const nudgeSwap = document.getElementById('nudge-swap')
  const nudgeScroll = document.getElementById('nudge-scroll')
  const nudgeIncoming = document.getElementById('nudge-incoming')
  const nudgePercent = document.getElementById('nudge-percent')
  const breakOrbit = document.querySelector<HTMLButtonElement>('#break-orbit')
  const flash = document.getElementById('impact-flash')
  const warpCanvas = document.querySelector<HTMLCanvasElement>('#warp-canvas')
  if (!stage || !spacer || !heroPin || !progressBar || !nudge || !flash || !warpCanvas) return null
  if (!nudgeSwap || !nudgeScroll || !nudgeIncoming || !nudgePercent) return null
  if (!breakOrbit) return null
  return {
    stage, spacer, heroPin, progressBar, nudge,
    nudgeSwap, nudgeScroll, nudgeIncoming, nudgePercent, breakOrbit, flash, warpCanvas,
  }
}

/** Hands the page straight to the hero — used for reduced-motion and WebGL failure. */
function skipIntro(el: Elements): void {
  el.stage.style.display = 'none'
  el.spacer.style.display = 'none'
  el.nudge.style.display = 'none'
  el.progressBar.style.display = 'none'
  el.flash.style.display = 'none'
  el.heroPin.style.opacity = ''
  document.body.classList.add('intro-done')
  window.scrollTo(0, 0)
}

export function initScrollIntro(): void {
  const el = getElements()
  if (el) run(el)
}

function run(el: Elements): void {
  el.spacer.style.height = `${CONFIG.scrollLengthVh}vh`

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    skipIntro(el)
    return
  }

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  } catch {
    skipIntro(el)
    return
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  el.stage.appendChild(renderer.domElement)

  const space = createSpaceScene(window.innerWidth / window.innerHeight)
  const ascii = new AsciiRenderer(renderer)
  const warp = createWarp(el.warpCanvas)

  let viewportHeight = window.innerHeight

  function resize(): void {
    const width = window.innerWidth
    const height = window.innerHeight
    viewportHeight = height
    renderer.setSize(width, height)
    ascii.setSize(width, height)
    warp.setSize(width, height)
    space.setAspect(width / height)
  }
  resize()

  // --- scroll progress -----------------------------------------------------
  let targetProgress = 0
  let currentProgress = 0
  let released = false
  let stopped = false
  /** Timestamp the scroll first reached the spacer bottom, or 0. */
  let pastBottomAt = 0
  /** Previous frame timestamp, for frame-rate independent smoothing. */
  let lastFrameAt = 0

  const maxScroll = () => Math.max(el.spacer.offsetHeight - viewportHeight, 1)
  const spacerBottom = () => el.spacer.offsetHeight

  function readScroll(): void {
    targetProgress = THREE.MathUtils.clamp(window.scrollY / maxScroll(), 0, 1)
  }

  // --- eased programmatic scroll (load nudge + end auto-advance) ------------
  let autoScrolling = false
  let autoScrollCancelled = false

  /**
   * @param force skips the yield-to-user guards. Only the committed landing uses
   * it — there, input is being blocked anyway and the tween must finish.
   */
  /**
   * Generation stamp for the tween. A forced tween ignores the user-yield
   * guards by design, which also made it unstoppable by the page itself — and
   * the landing needs exactly that: it fires at flashTo, which can be a few
   * frames before the committed tween's duration runs out, and a surviving
   * tween frame would scroll the page straight back off the hero it had just
   * been placed on. Bumping the stamp orphans every in-flight step loop.
   */
  let scrollTweenStamp = 0

  function stopAutoScroll(): void {
    scrollTweenStamp++
    autoScrolling = false
  }

  function smoothScrollTo(
    targetY: number,
    duration: number,
    options: { force?: boolean; onDone?: () => void } = {},
  ): void {
    const { force = false, onDone } = options
    const stamp = ++scrollTweenStamp
    autoScrolling = true
    autoScrollCancelled = false
    const startY = window.scrollY
    const distance = targetY - startY
    const startTime = performance.now()
    let lastSetY = -1

    function step(now: number): void {
      // A newer tween or an explicit stop owns the scroll now.
      if (stamp !== scrollTweenStamp) return
      // Any real input wins. Without this the page fights the user for the
      // duration of the tween, which feels broken far worse than no nudge.
      if (!force && autoScrollCancelled) {
        autoScrolling = false
        return
      }
      // Belt and braces: if the scroll position is not where we last put it,
      // something else moved the page (anchor jump, scrollbar drag, another
      // script). Yield rather than dragging the user back.
      if (!force && lastSetY >= 0 && Math.abs(window.scrollY - lastSetY) > 2) {
        autoScrolling = false
        return
      }
      const t = Math.min((now - startTime) / duration, 1)
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      window.scrollTo(0, startY + distance * eased)
      lastSetY = window.scrollY
      if (t < 1) {
        requestAnimationFrame(step)
      } else {
        autoScrolling = false
        onDone?.()
      }
    }
    requestAnimationFrame(step)
  }

  /*
   * Commit zone. Past `commitAt` the reader is no longer steering: wheel, touch
   * and scroll keys are swallowed and the page drives itself to the hero.
   *
   * This is what stops someone resting halfway through the white-out, and it
   * doubles as the fix for overshooting the hero — by the time input is handed
   * back, the fling that would have carried them into the next section has
   * already decayed against a blocked page.
   */
  let committed = false
  let settleTimer = 0

  const SCROLL_KEYS = new Set([
    'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ', 'Spacebar',
  ])

  /*
   * Upward scroll at the top of the hero is held rather than passed through.
   *
   * It no longer earns a way back into the flight — leaving is the button's job
   * now, and a deliberate press is a better door than an accumulated shove. This
   * only stops the reader falling back through the hand-off they just came
   * through, which is what would otherwise happen: the intro's scroll budget
   * still sits above the hero, so any upward overshoot lands inside the flight.
   */
  const heroTop = () => el.heroPin.offsetTop

  /**
   * Swallow an upward input that would carry above the hero.
   *
   * Engages not just when parked at the hero top but whenever the input *would
   * carry past it*. Requiring the reader to already be parked there meant a fast
   * fling — one wheel event with a large delta — jumped the boundary in a single
   * step and was never caught at all.
   *
   * Pushing against the boundary is also the whole trigger for the way back out:
   * it surfaces the break-orbit button, briefly. The deep-space drawer this used
   * to open — with its rest-detection to tell a deliberate push from arriving
   * momentum — is gone; a button that withdraws by itself is cheap enough to
   * offer on any push, including the overshoot of merely scrolling to the top.
   */
  function absorbUpward(upward: number): boolean {
    if (!released || committed || upward <= 0) return false

    const remaining = window.scrollY - heroTop()
    if (remaining > upward) return false
    // Input spent travelling to the boundary is used up by the travel; whatever
    // is left is overscroll and is swallowed rather than passed to the flight.
    if (remaining > 0) window.scrollTo(0, heroTop())
    offerBreakOrbit()
    return true
  }

  /*
   * The button is offered once the reader pushes against the top of the hero,
   * and withdrawn either when they clearly move on or after a quiet spell.
   *
   * The timer is only safe because of `held` below. A control that disappears
   * from under a cursor already reaching for it is worse than one that never
   * came, so hovering or focusing it suspends the countdown outright, and every
   * fresh upward push restarts it.
   */
  let offered = false
  /** True while the pointer is over the button or it has keyboard focus. */
  let held = false
  let offerTimer = 0

  function armWithdraw(): void {
    window.clearTimeout(offerTimer)
    if (!offered || held) return
    offerTimer = window.setTimeout(withdrawBreakOrbit, CONFIG.exit.offerMs)
  }

  function offerBreakOrbit(): void {
    if (!offered) {
      offered = true
      el.breakOrbit.classList.add('is-offered')
    }
    // Re-armed on every push, not just the first: still trying to leave should
    // keep the way out on screen.
    armWithdraw()
  }

  function withdrawBreakOrbit(): void {
    window.clearTimeout(offerTimer)
    if (!offered) return
    offered = false
    el.breakOrbit.classList.remove('is-offered')
  }

  function hold(): void {
    held = true
    window.clearTimeout(offerTimer)
  }

  function release(): void {
    held = false
    armWithdraw()
  }

  el.breakOrbit.addEventListener('pointerenter', hold)
  el.breakOrbit.addEventListener('pointerleave', release)
  el.breakOrbit.addEventListener('focus', hold)
  el.breakOrbit.addEventListener('blur', release)

  function breakOrbit(): void {
    withdrawBreakOrbit()
    released = false
    document.body.classList.remove('intro-done')
    // Going back up should never replay the entry. Whatever is on screen decays
    // quickly instead of snapping off, and the fade holds the surface so the
    // restarted frame loop cannot repaint streaks from the re-entry progress.
    warp.fadeOut(CONFIG.warp.exitMs)
    el.stage.style.opacity = '1'
    el.progressBar.style.opacity = '1'

    /*
     * Back to the start of the flight, not to the tail of it.
     *
     * Re-entering near the end dropped the reader a few hundred pixels short of
     * the landing they had just left, close enough to the commit and the
     * auto-advance that the flight was over before it registered as having
     * begun. Breaking orbit is a decision to go back out, so it gives back the
     * whole descent.
     *
     * The camera is snapped rather than lerped: easing from 1 down to 0 would
     * play the entire flight backwards at frame rate, white-out included.
     */
    // Give the flight its scroll budget back before measuring anything against
    // it — the landing collapsed the spacer to nothing.
    el.spacer.style.height = `${CONFIG.scrollLengthVh}vh`
    window.scrollTo(0, 0)
    readScroll()
    currentProgress = targetProgress

    // A fresh run, so both assists go back to how they start rather than being
    // suppressed — at progress 0 there is nothing for them to haul the reader
    // into, and the descent ahead should behave exactly like the first one.
    commitArmed = true
    advanceTriggered = false

    if (stopped) {
      stopped = false
      requestAnimationFrame(frame)
    }
  }

  function onWheel(event: WheelEvent): void {
    if (committed) {
      /*
       * The settle gate is one-way. After landing (`released`), downward input
       * is exactly the reader carrying on into the showcase, and holding it for
       * the rest of the settle made the page feel dead for the first scroll —
       * the block only needs to stop the landing's own momentum from bouncing
       * back up into the flight, and mid-flight (not yet released) everything
       * is still swallowed because the page is driving itself.
       */
      if (!released || event.deltaY <= 0) event.preventDefault()
      return
    }
    if (event.deltaY >= 0) return
    if (absorbUpward(-event.deltaY)) event.preventDefault()
  }

  let lastTouchY = 0
  function onTouchStart(event: TouchEvent): void {
    lastTouchY = event.touches[0]?.clientY ?? 0
  }
  function onTouchMove(event: TouchEvent): void {
    const y = event.touches[0]?.clientY ?? 0
    // Finger travelling down drags the page up.
    const delta = y - lastTouchY
    lastTouchY = y
    if (committed) {
      // Same one-way settle as the wheel: after landing, a finger travelling
      // up (scrolling on) passes through; everything else is still swallowed.
      if (!released || delta >= 0) event.preventDefault()
      return
    }
    if (delta <= 0) return
    if (absorbUpward(delta * 2)) event.preventDefault()
  }

  const UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])

  el.breakOrbit.addEventListener('click', () => {
    if (!released || committed) return
    breakOrbit()
  })

  // Non-passive on purpose — preventDefault is the whole point.
  window.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchmove', onTouchMove, { passive: false })
  /*
   * One keydown listener, not two. The gate and the keyboard-scrolling fallback
   * have to share a handler because preventDefault does not stop a programmatic
   * scroll: a second listener calling scrollBy ran *after* this one had absorbed
   * an ArrowUp and cancelled the native scroll, and moved the page anyway —
   * which walked the reader straight back into the flight past the gate.
   */
  window.addEventListener('keydown', (event) => {
    if (committed && SCROLL_KEYS.has(event.key)) {
      // One-way settle again: after landing, downward keys fall through to the
      // scrollBy fallback below so the reader can carry on immediately.
      if (!released || UP_KEYS.has(event.key)) {
        event.preventDefault()
        return
      }
    }

    if (UP_KEYS.has(event.key) && absorbUpward(CONFIG.exit.keyStep)) {
      event.preventDefault()
      return
    }

    // Reached only when the gate did not claim the key. The page hides its
    // scrollbar, so this is the whole of its keyboard scrolling.
    if (event.key === 'ArrowDown' || event.key === ' ') window.scrollBy(0, 220)
    else if (event.key === 'ArrowUp') window.scrollBy(0, -220)
  })

  /** Cleared once a commit fires; re-arms only after scrolling well back. */
  let commitArmed = true

  function maybeCommit(): void {
    if (committed || released) return

    if (!commitArmed) {
      if (targetProgress < CONFIG.commitRearmAt) commitArmed = true
      return
    }

    // Deliberately targetProgress ONLY, never currentProgress. The latter lags
    // the scroll, so on the way back up from the hero it is still near 1 while
    // the reader has already scrolled well clear — testing it re-fired the
    // commit instantly and dragged them back down, making the flash a one-way
    // door. Intent lives in targetProgress.
    if (targetProgress < CONFIG.commitAt) return

    committed = true
    commitArmed = false
    window.clearTimeout(settleTimer)
    smoothScrollTo(spacerBottom(), CONFIG.commitDuration, { force: true })
  }

  let advanceTriggered = false
  let lastAdvance = 0

  function onScroll(): void {
    readScroll()

    /*
     * Catch-all for the gate. The input handlers above cover wheel, touch and
     * keys, but they cannot see scrollbar drags, scroll-snap corrections, or any
     * momentum the browser applies without a cancellable event. Anything that
     * lands above the hero while released is pulled straight back, so the flight
     * cannot be re-entered by accident no matter what moved the page.
     *
     * breakOrbit clears `released` before it scrolls, so the legitimate exit is
     * not caught here. Re-entry is solely breakOrbit's job.
     */
    if (released && !committed && window.scrollY < heroTop()) {
      window.scrollTo(0, heroTop())
      readScroll()
      offerBreakOrbit()
    } else if (released && window.scrollY > heroTop() + CONFIG.exit.offerHideBelow) {
      withdrawBreakOrbit()
    }
  }

  /**
   * Evaluated every frame rather than on scroll events.
   *
   * On a scroll event the guards below can legitimately reject — most often
   * because a programmatic scroll is still in flight — and if that was the last
   * event in a fling, nothing would ever re-check and the reader would be left
   * to grind out the tail by hand. The frame loop always comes back around.
   */
  function maybeAutoAdvance(now: number): void {
    if (!CONFIG.autoAdvance || autoScrolling) return
    if (advanceTriggered && targetProgress < CONFIG.autoAdvanceRearmAt) advanceTriggered = false
    if (advanceTriggered || targetProgress < CONFIG.autoAdvanceAt) return
    if (now - lastAdvance < 2500) return

    lastAdvance = now
    // Stays true even if the reader interrupts the tween, so the page backs off
    // for good rather than grabbing them again every couple of seconds.
    advanceTriggered = true
    smoothScrollTo(spacerBottom(), CONFIG.autoAdvanceDuration)
  }

  // --- scroll pill ---------------------------------------------------------
  /*
   * Both labels live in the DOM at once and crossfade. The pill's width is
   * driven from their measured widths so it can transition rather than jump,
   * which means the widths have to be read once up front — and after webfonts
   * land, since measuring against the fallback face gives the wrong numbers and
   * the pill would settle to a size that does not fit its text.
   */
  let nudgeIsIncoming = false
  let nudgePercentShown = -1
  let scrollLabelWidth = 0
  let incomingLabelWidth = 0

  function measureNudge(): void {
    const shown = el.nudgePercent.textContent
    // Widest the counter ever gets, so the pill never has to grow mid-flight.
    el.nudgePercent.textContent = '100%'
    incomingLabelWidth = el.nudgeIncoming.scrollWidth
    el.nudgePercent.textContent = shown
    scrollLabelWidth = el.nudgeScroll.scrollWidth
    el.nudgeSwap.style.width = `${nudgeIsIncoming ? incomingLabelWidth : scrollLabelWidth}px`
  }

  function setNudgeState(incoming: boolean): void {
    if (incoming === nudgeIsIncoming) return
    nudgeIsIncoming = incoming
    el.nudgeScroll.classList.toggle('is-hidden', incoming)
    el.nudgeIncoming.classList.toggle('is-hidden', !incoming)
    el.nudgeSwap.style.width = `${incoming ? incomingLabelWidth : scrollLabelWidth}px`
  }

  measureNudge()
  // Re-measure once the display face is actually in use.
  document.fonts?.ready.then(measureNudge).catch(() => {})

  // --- mouse parallax ------------------------------------------------------
  const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 }

  window.addEventListener('mousemove', (event) => {
    mouse.targetX = (event.clientX / window.innerWidth) * 2 - 1
    mouse.targetY = -(event.clientY / window.innerHeight) * 2 + 1
  }, { passive: true })

  document.addEventListener('mouseleave', () => {
    mouse.targetX = 0
    mouse.targetY = 0
  })

  // --- frame loop ----------------------------------------------------------
  // --- flyby tags -----------------------------------------------------------
  /*
   * The tags introducing the pilot, pinned to the book / cursor / hard hat.
   * Projected through the flight camera every rendered frame — including the
   * parallax pose, which is why the update is called while that offset is
   * still applied: positioned against the resting camera they would swim
   * against the bodies they are pointing at.
   */
  const tagElements = new Map<string, HTMLElement>()
  document
    .querySelectorAll<HTMLElement>('#scene-tags .scene-tag')
    .forEach((node) => {
      if (node.dataset.tag) tagElements.set(node.dataset.tag, node)
    })

  const tagCentre = new THREE.Vector3()
  const tagNdcCentre = new THREE.Vector3()
  const tagForward = new THREE.Vector3()

  /**
   * Which labels have been read already.
   *
   * A tag opens once and then stays open for as long as you keep flying
   * forward — passing a body should not snatch its label away mid-sentence,
   * which is what a purely positional test does the moment the body swings
   * wide. Only reversing back past one closes it again.
   */
  const tagOpened = new Map<string, boolean>()
  /**
   * Each caption's on-screen position, smoothed.
   *
   * The raw projection is exact but harsh: near the flyby a body's screen
   * position accelerates hard, and the clamp that keeps the caption under the
   * silhouette re-portions its offset at the same time — text bolted to that
   * moves in a way hands never drew. Easing toward the target each frame
   * turns the ride into a glide; the caption still follows its body, it just
   * arrives a beat behind, like a title catching up to its subject.
   */
  const tagPos = new Map<string, { x: number; y: number }>()
  /**
   * Which side of the ball each bubble sits on (true = left, tail on its
   * right). Re-decided freely while the bubble is closed — it is invisible,
   * nobody sees it move — and frozen the moment it opens, so a ball drifting
   * across the middle of the screen cannot flip a bubble mid-read.
   */
  const tagFlip = new Map<string, boolean>()
  let tagLastProgress = 0
  let tagLastTime = 0

  /** Whether the boot cover has been told to dissolve; see the frame loop. */
  let bootLifted = false

  /** Whether any speech bubble is open this frame — the slow-mo trigger. */
  let tagAnyOpen = false
  /** The bullet-time factor, eased toward 1 while a bubble is open. */
  let slowmo = 0
  /** The scene's own clock, which runs slow during the flyby passes. */
  let sceneElapsed = 0

  /** Camera distance at which the dot appears / the label unfurls, world units. */
  const TAG_DOT_AT = 210
  const TAG_LABEL_AT = 150

  /*
   * How far off-centre a body may project and still carry its tag.
   *
   * Distance alone is the wrong gate. These bodies sit 26–52 units to the side
   * of the flight path, so their CLOSEST approach is also the moment they are
   * most nearly beside the camera — the tag swings out to a corner and reads as
   * a label stuck to the viewport edge rather than a callout on the thing. The
   * readable window is earlier, while the body is still ahead and framed, so
   * the tag is gated on where it lands on screen as well as how near it is.
   *
   * The label's band is tighter than the dot's, so a tag fades to a dot on its
   * way out of frame instead of vanishing mid-sentence.
   */
  const DOT_X = 0.95
  const DOT_Y = 0.86
  const LABEL_X = 0.68
  const LABEL_Y = 0.52

  const tagBallWorld = new THREE.Vector3()
  const tagBallTop = new THREE.Vector3()
  const tagBallNdc = new THREE.Vector3()
  const tagBallTopNdc = new THREE.Vector3()

  function updateSceneTags(): void {
    space.camera.getWorldDirection(tagForward)
    // Reversing is the only thing that closes a label; see tagOpened.
    const movingBack = currentProgress < tagLastProgress - 0.0004
    tagLastProgress = currentProgress

    // Frame-rate independent smoothing for the glide (see tagPos).
    const now = performance.now()
    const dt = tagLastTime ? Math.min((now - tagLastTime) / 1000, 0.05) : 1 / 60
    tagLastTime = now
    const ease = 1 - Math.pow(0.82, dt * 60)

    /*
     * The thought's anchor: the ball, not the body being passed.
     *
     * The bodies still decide WHICH thought is showing and WHEN — but the text
     * belongs to the reader's shooting star, floated up-and-right of its disc
     * like a comic thought, at an offset scaled from the ball's own projected
     * radius so the gap holds as the orbit swings it nearer and farther.
     */
    const width = window.innerWidth
    const height = window.innerHeight
    space.ball.getWorldPosition(tagBallWorld)
    tagBallTop.copy(tagBallWorld)
    tagBallTop.y += CONFIG.ball.radius
    tagBallNdc.copy(tagBallWorld).project(space.camera)
    tagBallTopNdc.copy(tagBallTop).project(space.camera)
    const ballX = (tagBallNdc.x * 0.5 + 0.5) * width
    const ballY = (-tagBallNdc.y * 0.5 + 0.5) * height
    const ballR = Math.abs(ballY - (-tagBallTopNdc.y * 0.5 + 0.5) * height)
    const thoughtY = Math.max(ballY - ballR - 64, 90)
    /* Which side has room: past 55% of the width, a right-hand bubble starts
       crowding the edge, so it swaps to the ball's left. Applied per tag below
       so an OPEN bubble keeps the side it opened on. */
    const wantFlip = ballX > width * 0.55

    let anyOpen = false
    for (const anchor of space.tagAnchors) {
      const node = tagElements.get(anchor.key)
      if (!node) continue

      anchor.object.getWorldPosition(tagCentre)
      tagNdcCentre.copy(tagCentre).project(space.camera)
      const distance = space.camera.position.distanceTo(tagCentre)
      /* Ahead of the camera, not just "projects inside the frame" — a point
         behind the camera projects to a mirrored position that looks valid. */
      const ahead =
        tagForward.dot(tagCentre.clone().sub(space.camera.position)) > 10

      const show =
        ahead &&
        distance < TAG_DOT_AT &&
        Math.abs(tagNdcCentre.x) < DOT_X &&
        Math.abs(tagNdcCentre.y) < DOT_Y

      /*
       * The body first, then the words about it.
       *
       * Shaped bodies materialize on approach, and the positional bands alone
       * let the bubble open while its subject was still a half-faded ghost —
       * the label introduced something the reader hadn't seen yet. The body's
       * reveal fade gates the open. Past-half rather than fully drawn: the
       * cursor's label window closes before its fade completes, so a strict
       * gate starved it entirely — and with the bubble's own 0.4s entrance on
       * top, "clearly visible" is already comfortably body-first.
       */
      const revealed =
        anchor.materials.length === 0 || anchor.materials[0].opacity > 0.55

      const canOpen =
        show &&
        revealed &&
        distance < TAG_LABEL_AT &&
        Math.abs(tagNdcCentre.x) < LABEL_X &&
        Math.abs(tagNdcCentre.y) < LABEL_Y

      let opened = tagOpened.get(anchor.key) ?? false
      if (canOpen) opened = true
      else if (movingBack) opened = false
      tagOpened.set(anchor.key, opened)

      const isOpen = show && opened
      if (isOpen) anyOpen = true
      node.classList.toggle('is-near', isOpen)
      if (!show) {
        // Forget the glide state so a re-appearing thought snaps to the ball
        // instead of sailing in from wherever it was last seen.
        tagPos.delete(anchor.key)
        continue
      }

      // Closed bubbles are invisible, so their side can track the ball freely;
      // an open one holds the side it sprouted on.
      if (!isOpen) tagFlip.set(anchor.key, wantFlip)
      const flip = tagFlip.get(anchor.key) ?? false
      node.classList.toggle('is-flip', flip)

      const thoughtX = Math.min(
        Math.max(ballX + (flip ? -1 : 1) * (ballR + 72), 170),
        width - 170,
      )

      let pos = tagPos.get(anchor.key)
      if (!pos) {
        pos = { x: thoughtX, y: thoughtY }
        tagPos.set(anchor.key, pos)
      } else {
        pos.x += (thoughtX - pos.x) * ease
        pos.y += (thoughtY - pos.y) * ease
      }

      node.style.transform = `translate3d(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px, 0)`
    }

    tagAnyOpen = anyOpen
  }

  const savedPosition = new THREE.Vector3()
  const savedQuaternion = new THREE.Quaternion()

  function frame(now: number): void {
    if (stopped) return
    requestAnimationFrame(frame)

    // Frame-rate independent smoothing. A raw per-frame lerp chases the target
    // twice as fast on a 120Hz display as on 60Hz, and crawls on a slow device —
    // where it would still be mid-flight when the assisted landing finishes.
    // Normalising to 60Hz keeps the feel identical everywhere.
    const deltaSeconds = lastFrameAt === 0 ? 1 / 60 : Math.min((now - lastFrameAt) / 1000, 0.25)
    lastFrameAt = now
    // Sharper convergence only once the wash has mostly covered the screen —
    // three quarters through its band, not at its start. Gating on committed
    // alone fast-forwarded the dive itself (display progress IS the scene, so a
    // tighter lerp is a faster ball no matter what the scroll underneath does),
    // and gating at washFrom broke the same way the moment the wash started
    // earlier: at its leading edge the cover is transparent. The flight keeps
    // its cinematic inertia while anything can be seen; the sharp rate buys the
    // quick hand-off behind a cover that is already nearly solid.
    const washCovered =
      CONFIG.warp.washFrom + 0.75 * (CONFIG.flashTo - CONFIG.warp.washFrom)
    const rate =
      committed && currentProgress >= washCovered
        ? CONFIG.commitSmoothing
        : CONFIG.scrollSmoothing
    const smoothing = 1 - Math.pow(1 - rate, deltaSeconds * 60)

    /*
     * Bullet time at the flybys. While a speech bubble is open the scene
     * chases the scroll at a fraction of its usual rate and the scene clock
     * itself runs slow, so the same wheel input carries the reader past the
     * body in a long, hung moment — and releases with a little catch-up rush
     * as the bubble closes. Eased in and out so the time-shift is a dip, not
     * a gear change. Never engaged during the committed landing: that flight
     * drives itself and has its own pacing.
     */
    const slowTarget = tagAnyOpen && !committed ? 1 : 0
    slowmo += (slowTarget - slowmo) * (1 - Math.pow(0.88, deltaSeconds * 60))
    sceneElapsed += deltaSeconds * 1000 * (1 - 0.7 * slowmo)

    currentProgress = THREE.MathUtils.lerp(
      currentProgress,
      targetProgress,
      smoothing * (1 - 0.8 * slowmo),
    )
    if (Math.abs(currentProgress - targetProgress) < 0.0004) currentProgress = targetProgress

    space.update(currentProgress, sceneElapsed, slowmo)
    maybeAutoAdvance(now)
    maybeCommit()

    const pastBottom = window.scrollY >= spacerBottom()

    if (released && !pastBottom) {
      document.body.classList.remove('intro-done')
      released = false
    }

    /*
     * Entry streaks only. Runs before the hand-off check and unconditionally:
     * the scroll can reach the bottom well before `currentProgress` catches up,
     * and releasing on scroll position alone would cut them off partway.
     *
     * The cover masks the canvas-to-hero swap, and is dark rather than light —
     * a dip to black on the way in instead of a blown-out flash.
     */
    const flash = Math.min(
      Math.max((currentProgress - CONFIG.flashFrom) / (CONFIG.flashTo - CONFIG.flashFrom), 0),
      1,
    )
    /*
     * Saturates at flashTo, not at 1: the hand-off below fires at 0.999, and a
     * cover still ramping toward 1.0 there would be ~95% opaque — enough of the
     * ASCII scene bleeds through for the swap to flicker.
     */
    const wash = Math.min(
      Math.max((currentProgress - CONFIG.warp.washFrom) / (CONFIG.flashTo - CONFIG.warp.washFrom), 0),
      1,
    )
    warp.render(now, flash, wash)
    el.stage.style.opacity = '1'
    el.heroPin.style.opacity = '0'
    el.progressBar.style.opacity = String(1 - flash)

    // Hand off to the hero once the spacer is scrolled AND the fade has resolved.
    // The timeout is a backstop: if the lerp somehow never converges we still
    // release rather than leaving a fixed, half-faded canvas over the page.
    if (pastBottom) {
      if (pastBottomAt === 0) pastBottomAt = now
      /*
       * Release once the wash is opaque, not once progress is exhausted. The
       * wash saturates at flashTo, and past that point every further frame of
       * convergence is spent rendering an all-black canvas nobody can see —
       * waiting for 0.999 held the reader there for most of a second.
       */
      if (currentProgress >= CONFIG.flashTo || now - pastBottomAt > 2000) {
        released = true
        el.stage.style.opacity = ''
        el.heroPin.style.opacity = ''
        el.progressBar.style.opacity = ''
        el.nudge.style.opacity = ''
        document.body.classList.add('intro-done')

        /*
         * Collapse the flight's scroll budget, then land at the top.
         *
         * The spacer is 360vh of nothing whose only job is to drive the flight,
         * and once the flight is over it is 360vh of *spent* nothing that the
         * document still carries. That is the scrollbar's problem: it measures
         * the whole document, so the reader arriving at the hero found the thumb
         * already most of the way down a track whose top half they could never
         * go back to. The bar was describing a page that no longer exists.
         *
         * Collapsing it here is free of any jump. We are landing at heroTop and
         * heroTop is the spacer's height, so removing exactly that much from
         * above us and setting scroll to 0 leaves every pixel where it was — the
         * hero simply becomes the top of the document, which is what it is.
         *
         * breakOrbit restores the height before flying again.
         */
        stopAutoScroll()
        el.spacer.style.height = '0px'
        window.scrollTo(0, 0)
        committed = true
        window.clearTimeout(settleTimer)
        settleTimer = window.setTimeout(() => {
          committed = false
        }, CONFIG.landSettleMs)

        // Hero is underneath a fully dark screen. The frame loop stops on the
        // next line, so the warp lifts this cover on its own clock.
        warp.fadeOut(CONFIG.warp.settleMs)
        stopped = true
        return
      }
    } else {
      pastBottomAt = 0
    }

    el.progressBar.style.width = `${currentProgress * 100}%`

    // The pill persists through the whole flight rather than fading after the
    // first scroll: prompt first, then distance to Earth. Percentage is measured
    // against the impact, not the end of the scroll, so it reads 100% exactly
    // when the ball arrives rather than during the white-out.
    setNudgeState(currentProgress > CONFIG.nudgeSwitchAt)
    // Same threshold docks the title card into the corners — the two moves
    // reading as one "the game has started" beat is the point.
    document.body.classList.toggle('title-away', currentProgress > CONFIG.nudgeSwitchAt)
    if (nudgeIsIncoming) {
      const toEarth = Math.min(currentProgress / CONFIG.impactAt, 1)
      const percent = Math.round(toEarth * 100)
      // Only touch the DOM when the rounded value actually changes.
      if (percent !== nudgePercentShown) {
        nudgePercentShown = percent
        el.nudgePercent.textContent = `${percent}%`
      }
    }
    el.nudge.style.opacity = String(1 - flash)
    updateHud8()

    // Parallax is applied for the render only, then reverted — otherwise the
    // offset compounds every frame and the camera walks off the path.
    const { parallax } = CONFIG
    if (parallax.enabled) {
      savedPosition.copy(space.camera.position)
      savedQuaternion.copy(space.camera.quaternion)

      mouse.x = THREE.MathUtils.lerp(mouse.x, mouse.targetX, parallax.smoothing)
      mouse.y = THREE.MathUtils.lerp(mouse.y, mouse.targetY, parallax.smoothing)

      // Intensity opens up over the first 30% so the opening beat stays composed.
      const ramp = Math.min(currentProgress / 0.3, 1)
      const horizontal = THREE.MathUtils.lerp(parallax.horizontalMin, parallax.horizontalMax, ramp)

      space.camera.translateX(mouse.x * horizontal)
      space.camera.translateY(mouse.y * parallax.vertical)
      space.camera.rotateY(-mouse.x * parallax.rotation)

      ascii.render(space.scene, space.camera)
      updateSceneTags()

      space.camera.position.copy(savedPosition)
      space.camera.quaternion.copy(savedQuaternion)
    } else {
      ascii.render(space.scene, space.camera)
      updateSceneTags()
    }

    /*
     * Lift the boot cover only after a frame has actually painted beneath it,
     * plus a beat for the fill bar to finish — so the arrival is a dissolve
     * into a complete scene, never a pop into a half-built one.
     */
    if (!bootLifted) {
      bootLifted = true
      window.setTimeout(() => document.body.classList.add('booted'), 550)
    }
  }

  // --- 8-bit HUD ------------------------------------------------------------
  const hudFill = document.getElementById('hud8-fill')
  const hudPct = document.getElementById('hud8-pct')
  let hudPctShown = -1

  /** Hull bar + distance counter. Fill snaps to 10% segments — chunky on purpose. */
  function updateHud8(): void {
    const percent = Math.round(Math.min(currentProgress / CONFIG.impactAt, 1) * 100)
    if (percent === hudPctShown) return
    hudPctShown = percent
    if (hudFill) hudFill.style.width = `${Math.round(percent / 10) * 10}%`
    if (hudPct) hudPct.textContent = `%${percent}`
  }

  // --- wiring --------------------------------------------------------------
  function interruptAutoScroll(): void {
    // The committed landing is deliberately not interruptible.
    if (committed) return
    if (autoScrolling) autoScrollCancelled = true
  }
  window.addEventListener('wheel', interruptAutoScroll, { passive: true })
  window.addEventListener('touchstart', interruptAutoScroll, { passive: true })
  window.addEventListener('keydown', interruptAutoScroll)

  window.addEventListener('scroll', onScroll, { passive: true })

  let resizeTimer = 0
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(resize, 120)
  })

  readScroll()
  currentProgress = targetProgress
  requestAnimationFrame(frame)

  // A small self-scroll on load: the clearest possible signal that this page
  // responds to scrolling, without a "scroll down" label doing the work.
  requestAnimationFrame(() => {
    if (window.scrollY === 0) smoothScrollTo(maxScroll() * 0.02, 1100)
  })
}
