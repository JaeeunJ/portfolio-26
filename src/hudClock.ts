/*
 * The local time, ticking in the HUD's bottom instrument row.
 *
 * Scheduled to the next second boundary each tick rather than on a fixed 1000ms
 * interval. setInterval drifts — each tick is scheduled a full second after the
 * previous one *fired*, so the accumulated lateness never gets corrected and the
 * display eventually skips a second outright. Aiming at the boundary keeps the
 * readout flipping when the wall clock does.
 */

const pad = (value: number): string => String(value).padStart(2, '0')

export function initHudClock(): void {
  const el = document.getElementById('hud-time')
  if (!el) return

  let timer = 0

  function tick(): void {
    const now = new Date()
    el!.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000))
  }

  tick()

  // A background tab throttles timers, so the readout is stale on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    window.clearTimeout(timer)
    tick()
  })
}
