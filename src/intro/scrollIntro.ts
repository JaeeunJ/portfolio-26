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
  introSkip: HTMLAnchorElement | null
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
  const introSkip = document.querySelector<HTMLAnchorElement>('#intro-skip')
  if (!stage || !spacer || !heroPin || !progressBar || !nudge || !flash || !warpCanvas) return null
  if (!nudgeSwap || !nudgeScroll || !nudgeIncoming || !nudgePercent) return null
  if (!breakOrbit) return null
  return {
    stage, spacer, heroPin, progressBar, nudge,
    nudgeSwap, nudgeScroll, nudgeIncoming, nudgePercent, breakOrbit, flash, warpCanvas,
    introSkip,
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
      if (stamp !== scrollTweenStamp) return
      if (!force && autoScrollCancelled) {
        autoScrolling = false
        return
      }
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

  let committed = false
  let settleTimer = 0

  const SCROLL_KEYS = new Set([
    'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ', 'Spacebar',
  ])

  const heroTop = () => el.heroPin.offsetTop

  function absorbUpward(upward: number): boolean {
    if (!released || committed || upward <= 0) return false

    const remaining = window.scrollY - heroTop()
    if (remaining > upward) return false
    if (remaining > 0) window.scrollTo(0, heroTop())
    offerBreakOrbit()
    return true
  }

  let offered = false
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
    warp.fadeOut(CONFIG.warp.exitMs)
    el.stage.style.opacity = '1'
    el.stage.style.display = ''
    el.progressBar.style.opacity = '1'
    el.progressBar.style.display = ''
    el.nudge.style.display = ''

    el.spacer.style.height = `${CONFIG.scrollLengthVh}vh`
    window.scrollTo(0, 0)
    readScroll()
    currentProgress = targetProgress

    commitArmed = true
    advanceTriggered = false

    if (stopped) {
      stopped = false
      requestAnimationFrame(frame)
    }
  }

  // --- Quick Skip to Work button handler ---
  el.introSkip?.addEventListener('click', (e) => {
    e.preventDefault()

    // 1. Terminate flight loop & tweens
    stopAutoScroll()
    stopped = true

    // 2. Clear spacer and unlock page flow
    el.spacer.style.height = '0px'
    window.scrollTo(0, 0)

    // 3. Mark intro complete and state released
    document.body.classList.add('intro-done')
    released = true      // <-- ALLOWS absorbUpward() and breakOrbit() to activate
    committed = false     // <-- UNLOCKS input guards

    // 4. Hide canvas and HUD elements
    el.stage.style.display = 'none'
    el.stage.style.opacity = '0'
    el.progressBar.style.display = 'none'
    el.nudge.style.display = 'none'
    el.heroPin.style.opacity = ''
    warp.fadeOut(CONFIG.warp.settleMs)

    // 5. Scroll straight to work
    const workSection = document.getElementById('work')
    workSection?.scrollIntoView({ behavior: 'smooth' })
  })
  function onWheel(event: WheelEvent): void {
    if (committed) {
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
    const delta = y - lastTouchY
    lastTouchY = y
    if (committed) {
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

  window.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchmove', onTouchMove, { passive: false })

  window.addEventListener('keydown', (event) => {
    if (committed && SCROLL_KEYS.has(event.key)) {
      if (!released || UP_KEYS.has(event.key)) {
        event.preventDefault()
        return
      }
    }

    if (UP_KEYS.has(event.key) && absorbUpward(CONFIG.exit.keyStep)) {
      event.preventDefault()
      return
    }

    if (event.key === 'ArrowDown' || event.key === ' ') window.scrollBy(0, 220)
    else if (event.key === 'ArrowUp') window.scrollBy(0, -220)
  })

  let commitArmed = true

  function maybeCommit(): void {
    if (committed || released) return

    if (!commitArmed) {
      if (targetProgress < CONFIG.commitRearmAt) commitArmed = true
      return
    }

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

    if (released && !committed && window.scrollY < heroTop()) {
      window.scrollTo(0, heroTop())
      readScroll()
      offerBreakOrbit()
    } else if (released && window.scrollY > heroTop() + CONFIG.exit.offerHideBelow) {
      withdrawBreakOrbit()
    }
  }

  function maybeAutoAdvance(now: number): void {
    if (!CONFIG.autoAdvance || autoScrolling) return
    if (advanceTriggered && targetProgress < CONFIG.autoAdvanceRearmAt) advanceTriggered = false
    if (advanceTriggered || targetProgress < CONFIG.autoAdvanceAt) return
    if (now - lastAdvance < 2500) return

    lastAdvance = now
    advanceTriggered = true
    smoothScrollTo(spacerBottom(), CONFIG.autoAdvanceDuration)
  }

  // --- scroll pill ---------------------------------------------------------
  let nudgeIsIncoming = false
  let nudgePercentShown = -1
  let scrollLabelWidth = 0
  let incomingLabelWidth = 0

  function measureNudge(): void {
    const shown = el.nudgePercent.textContent
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

  // --- flyby tags -----------------------------------------------------------
  const tagElements = new Map<string, HTMLElement>()
  document
    .querySelectorAll<HTMLElement>('#scene-tags .scene-tag')
    .forEach((node) => {
      if (node.dataset.tag) tagElements.set(node.dataset.tag, node)
    })

  const tagCentre = new THREE.Vector3()
  const tagNdcCentre = new THREE.Vector3()
  const tagForward = new THREE.Vector3()

  const tagOpened = new Map<string, boolean>()
  const tagPos = new Map<string, { x: number; y: number }>()
  const tagFlip = new Map<string, boolean>()
  let tagLastProgress = 0
  let tagLastTime = 0

  let bootLifted = false
  let tagAnyOpen = false
  let slowmo = 0
  let sceneElapsed = 0

  const TAG_DOT_AT = 210
  const TAG_LABEL_AT = 150

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
    const movingBack = currentProgress < tagLastProgress - 0.0004
    tagLastProgress = currentProgress

    const now = performance.now()
    const dt = tagLastTime ? Math.min((now - tagLastTime) / 1000, 0.05) : 1 / 60
    tagLastTime = now
    const ease = 1 - Math.pow(0.82, dt * 60)

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
    const wantFlip = ballX > width * 0.55

    let anyOpen = false
    for (const anchor of space.tagAnchors) {
      const node = tagElements.get(anchor.key)
      if (!node) continue

      anchor.object.getWorldPosition(tagCentre)
      tagNdcCentre.copy(tagCentre).project(space.camera)
      const distance = space.camera.position.distanceTo(tagCentre)
      const ahead =
        tagForward.dot(tagCentre.clone().sub(space.camera.position)) > 10

      const show =
        ahead &&
        distance < TAG_DOT_AT &&
        Math.abs(tagNdcCentre.x) < DOT_X &&
        Math.abs(tagNdcCentre.y) < DOT_Y

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
        tagPos.delete(anchor.key)
        continue
      }

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

    const deltaSeconds = lastFrameAt === 0 ? 1 / 60 : Math.min((now - lastFrameAt) / 1000, 0.25)
    lastFrameAt = now

    const washCovered =
      CONFIG.warp.washFrom + 0.75 * (CONFIG.flashTo - CONFIG.warp.washFrom)
    const rate =
      committed && currentProgress >= washCovered
        ? CONFIG.commitSmoothing
        : CONFIG.scrollSmoothing
    const smoothing = 1 - Math.pow(1 - rate, deltaSeconds * 60)

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

    const flash = Math.min(
      Math.max((currentProgress - CONFIG.flashFrom) / (CONFIG.flashTo - CONFIG.flashFrom), 0),
      1,
    )
    const wash = Math.min(
      Math.max((currentProgress - CONFIG.warp.washFrom) / (CONFIG.flashTo - CONFIG.warp.washFrom), 0),
      1,
    )
    warp.render(now, flash, wash)
    el.stage.style.opacity = '1'
    el.heroPin.style.opacity = '0'
    el.progressBar.style.opacity = String(1 - flash)

    if (pastBottom) {
      if (pastBottomAt === 0) pastBottomAt = now
      if (currentProgress >= CONFIG.flashTo || now - pastBottomAt > 2000) {
        released = true
        el.stage.style.opacity = ''
        el.heroPin.style.opacity = ''
        el.progressBar.style.opacity = ''
        el.nudge.style.opacity = ''
        document.body.classList.add('intro-done')

        stopAutoScroll()
        el.spacer.style.height = '0px'
        window.scrollTo(0, 0)
        committed = true
        window.clearTimeout(settleTimer)
        settleTimer = window.setTimeout(() => {
          committed = false
        }, CONFIG.landSettleMs)

        warp.fadeOut(CONFIG.warp.settleMs)
        stopped = true
        return
      }
    } else {
      pastBottomAt = 0
    }

    el.progressBar.style.width = `${currentProgress * 100}%`

    setNudgeState(currentProgress > CONFIG.nudgeSwitchAt)
    document.body.classList.toggle('title-away', currentProgress > CONFIG.nudgeSwitchAt)
    if (nudgeIsIncoming) {
      const toEarth = Math.min(currentProgress / CONFIG.impactAt, 1)
      const percent = Math.round(toEarth * 100)
      if (percent !== nudgePercentShown) {
        nudgePercentShown = percent
        el.nudgePercent.textContent = `${percent}%`
      }
    }
    el.nudge.style.opacity = String(1 - flash)
    updateHud8()

    const { parallax } = CONFIG
    if (parallax.enabled) {
      savedPosition.copy(space.camera.position)
      savedQuaternion.copy(space.camera.quaternion)

      mouse.x = THREE.MathUtils.lerp(mouse.x, mouse.targetX, parallax.smoothing)
      mouse.y = THREE.MathUtils.lerp(mouse.y, mouse.targetY, parallax.smoothing)

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

    if (!bootLifted) {
      bootLifted = true
      window.setTimeout(() => document.body.classList.add('booted'), 550)
    }
  }

  // --- 8-bit HUD ------------------------------------------------------------
  const hudFill = document.getElementById('hud8-fill')
  const hudPct = document.getElementById('hud8-pct')
  let hudPctShown = -1

  function updateHud8(): void {
    const percent = Math.round(Math.min(currentProgress / CONFIG.impactAt, 1) * 100)
    if (percent === hudPctShown) return
    hudPctShown = percent
    if (hudFill) hudFill.style.width = `${Math.round(percent / 10) * 10}%`
    if (hudPct) hudPct.textContent = `%${percent}`
  }

  // --- wiring --------------------------------------------------------------
  function interruptAutoScroll(): void {
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

  requestAnimationFrame(() => {
    if (window.scrollY === 0) smoothScrollTo(maxScroll() * 0.02, 1100)
  })
}