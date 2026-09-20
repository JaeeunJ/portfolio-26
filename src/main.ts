// styles.css is linked from index.html's head so it blocks the first paint —
// imported from here it arrived after the module graph and the page flashed
// unstyled. Do not re-import it.
import { initScrollIntro } from './intro/scrollIntro'
import { initHudClock } from './hudClock'
import { initCursor } from './cursor'

initScrollIntro()
initHudClock()
initCursor()

// Game-over replay: Shift+R (or the footer prompt) restarts the run from the
// title screen. Reload rather than scroll — the intro's state machine is built
// around a fresh arrival, and a hard reset is what "play again" means anyway.
function playAgain(): void {
  history.scrollRestoration = 'manual'
  window.scrollTo(0, 0)
  location.reload()
}

window.addEventListener('keydown', (event) => {
  if (event.shiftKey && (event.key === 'R' || event.key === 'r')) playAgain()
})
document.getElementById('play-again')?.addEventListener('click', playAgain)

