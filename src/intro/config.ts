/**
 * Palette lifted from jaeeunj.github.io/portfolio so the intro reads as part of
 * the same site. Kept as hex strings — THREE.Color parses them and converts
 * sRGB -> linear automatically (ColorManagement is on by default).
 */
export const PALETTE = {
  void: '#07070F',
  deep: '#19192E',
  mid: '#262640',
  slate: '#484866',
  electric: '#113DDC',
  accent: '#6E8CFF',
  soft: '#A2B4FE',
  pale: '#CCD7FF',
  white: '#F7F7FF',
} as const

/**
 * Intro-only hues, deliberately outside the portfolio's blue range. The flight
 * borrows the palette of deep-field photography — warm dust, teal gas, violet
 * haze — while the page around it stays in the blues above.
 */
/**
 * Body palette — deep, saturated hues reserved for the planets. Everything
 * behind them (nebula, stars, dust) stays in muted portfolio blues, so the
 * bodies are the only colourful things in frame and read as the subjects.
 */
export const SPACE = {
  teal: '#2FB8A6',
  violet: '#7C5CE0',
  rose: '#E0507E',
  amber: '#E8883A',
  gold: '#EDB35C',
  magenta: '#B22D77',
  /**
   * Light enough that a lit hemisphere spans several ramp bands — at #8F5A2E
   * the whole day side compressed into one band and the sphere went flat.
   */
  umber: '#B0723C',
  /** Deep ochre for the Saturn ring — yellow read too bright against the body. */
  ochre: '#C0842C',
  /** Earth's continents. Bright enough that land and ocean land on clearly
      different ramp characters — a darker green merged into the sea. */
  leaf: '#4FBE72',
} as const

export const CONFIG = {
  /** Height of the scroll spacer, in vh. More = slower, more deliberate flight.
      Landed here after trying 360 (a grind) and 290 (the flybys rushed past
      before they could be enjoyed). */
  scrollLengthVh: 330,

  ascii: {
    /** CSS pixels per character cell. Smaller = finer detail, more GPU work. */
    cellSize: 10,
    /** Scene is rendered at cellGrid * supersample, then box-averaged per cell. */
    supersample: 3,
    /**
     * Sobel magnitude above which a cell draws a directional glyph instead of a
     * density one. High enough that only true silhouettes hatch — at 0.34 the
     * facet boundaries inside every planet tripped it too, and bodies rendered
     * as sparse slashes instead of filled surfaces.
     */
    edgeThreshold: 0.5,
    /** Cells dimmer than this render as blank space. Without it there is no negative space. */
    lumaFloor: 0.05,
    /** Midtone lift applied before the density ramp. <1 brightens, giving lit surfaces more range. */
    rampGamma: 0.45,
  },

  /** Per-frame lerp toward the scroll target. Low = heavy, cinematic inertia. */
  scrollSmoothing: 0.055,

  /**
   * The same lerp for the committed flight's final stretch — from `washFrom`
   * on, once the dark cover has started swallowing the frame. Behind the wash,
   * inertia is dead time: at 0.055 the display trailed the finished scroll by
   * a full second of black screen before the hand-off condition was met.
   *
   * Strictly the covered stretch only. Applied to the whole commit it
   * fast-forwarded the dive itself — display progress is what the scene renders
   * from, so a sharper lerp IS a faster ball regardless of scroll speed.
   */
  commitSmoothing: 0.18,

  parallax: {
    enabled: true,
    /** Camera offset ramps from min to max over the first 30% of the flight. */
    horizontalMin: 0.3,
    horizontalMax: 1.6,
    vertical: 0.5,
    rotation: 0.035,
    smoothing: 0.06,
  },

  /**
   * Dutch-angle roll. The reference site's camera is literally named
   * "DutchCamera", but its amplitude and rate are the main thing that made the
   * flight feel corkscrewed rather than travelled: at 0.38 over 1.5 full cycles
   * the horizon rotated ±22° and reversed three times on the way down.
   *
   * `rollCycles` is in full sine periods across the whole flight. Under 1 means
   * the camera banks one way and settles back, instead of rolling repeatedly.
   */
  maxRoll: 0.18,
  rollCycles: 0.75,

  ball: {
    radius: 2.8,
    /**
     * The ball orbits the camera's flight axis rather than sitting on it. This
     * is what makes the trail legible: an off-axis streak recedes toward the
     * vanishing point, whereas a trail directly ahead of the camera foreshortens
     * to a smear behind the head.
     */
    orbitRadius: 10,
    orbitWobble: 3,
    /**
     * Radians of orbit over the whole flight. One turn, not two and a half —
     * the ball still crosses the frame so its aura stays legible, but it no
     * longer spirals around the axis on the way down.
     */
    orbitTurns: Math.PI * 2,
    /** Phase at progress 0. -PI/2 places the ball at bottom-centre of frame. */
    orbitStartPhase: -Math.PI / 2,
    /**
     * Vertical excursion relative to horizontal.
     *
     * Doubles as the ball's start height: at progress 0 the orbit phase is
     * -PI/2, so the horizontal term is zero and this alone decides how far below
     * frame centre it begins. At 1.1 it sat on top of the HUD's pilot ID.
     */
    verticalFactor: 0.72,
    /**
     * How far ahead of the camera the ball flies, in curve-parameter units.
     * This trades against orbitRadius: the ball's angular offset from screen
     * centre is roughly atan(orbitRadius / leadDistance), and at ~600 units of
     * total path length a lead of 0.021 put it outside a 62° frustum entirely.
     */
    lead: 0.058,
    /**
     * A teardrop-shaped glow that trails the ball, rather than a geometric
     * ribbon. It is a single screen-facing sprite rotated to point away from the
     * direction of travel — far subtler than a swept ribbon, and it costs one
     * quad instead of 44 rebuilt segments per frame.
     */
    aura: {
      /** Round halo that always surrounds the ball. Multiple of ball radius. */
      haloScale: 3.6,
      /** Low enough that the halo shades the ramp around the ball instead of
          saturating a whole disc of cells to the solid top step. */
      haloOpacity: 0.28,

      /**
       * Teardrop tail. Fades in and extends with scroll speed, so the ball is a
       * plain round glow at rest and only draws out to a point while moving.
       */
      tailWidth: 3.4,
      tailOpacity: 0.62,
      /** Tail length as a multiple of its circular length (2x width). */
      tailRestLength: 0.85,
      tailMaxLength: 1.5,
      /** Progress-per-second at which the tail reaches full extension. */
      speedForFullStretch: 0.14,
      /** Per-frame smoothing on the speed estimate. Low = slow to react. */
      speedSmoothing: 0.12,

      /** Progress delta used to derive the direction of travel. */
      directionSample: 0.004,
    },
  },

  streaks: {
    count: 12,
    /** Times each streak fires over the full flight. Scroll is the main driver. */
    progressCycles: 5,
    /**
     * Cycles per second, independent of scroll. Small but non-zero: without it a
     * streak freezes mid-flight when you stop scrolling and reads as a scratch
     * on the screen. With it, in-flight streaks finish and clear, then the sky
     * stays quiet until you scroll again.
     */
    timeCycles: 0.05,
    /** Fraction of each cycle the streak is visible. */
    dutyCycle: 0.24,
    depthMin: 45,
    depthMax: 170,
    /** Half-width per unit depth — holds the streak at a constant hairline on screen. */
    halfWidthPerDepth: 0.0032,
    /**
     * Length as a fraction of the streak's own distance from the vanishing
     * point. Radial optic flow scales with radius, so streaks near the centre
     * are short and edge ones are long — that gradient is most of what sells the
     * depth.
     */
    lengthFactor: 0.85,
    /** Floor so centre streaks do not collapse to nothing. */
    minLengthPerDepth: 0.05,
    /** Radial distance from the vanishing point, in vertical half-extents. */
    radiusMin: 0.12,
    radiusMax: 0.85,
    /** Outward radial travel over a lifetime, same units as radius. */
    sweep: 0.32,
    segments: 10,
    opacity: 1.0,
  },

  /** Earth, sitting dead ahead at the end of the path. */
  earth: {
    /** How far beyond the end of the path its centre sits, in world units. */
    lead: 95,
    radius: 74,
    spin: 0.00007,
    /**
     * Emerges out of the dark rather than being there from the start. The book
     * passes at roughly 0.35, so this begins just after it clears frame.
     */
    revealFrom: 0.38,
    revealTo: 0.56,
  },

  /**
   * Progress at which the scroll pill switches from its prompt to the distance
   * readout. Above the load nudge's 2% self-scroll, so it only flips once the
   * reader has actually moved.
   */
  nudgeSwitchAt: 0.03,

  /** Progress at which the ball leaves its orbit and dives at Earth. */
  crashFrom: 0.84,
  /** Progress at which the ball meets the surface. */
  impactAt: 0.945,
  /**
   * Ramp for the entry streaks (see `warp`). Starts well before the impact,
   * unlike the flat white-out this replaced: the streaks read as being *pulled
   * in*, so they have to build during the dive rather than fire on contact.
   * Saturates just before the end, leaving a beat of held white before the hero.
   */
  flashFrom: 0.9,
  flashTo: 0.985,

  warp: {
    /**
     * Radial streaks — retired. The dark wash alone now carries the entry: the
     * white glyph-streaks emphasised a pull the dive already sells, and they
     * read as a second effect stacked on the first. Zero builds no lines and
     * leaves the machinery in place should they ever come back.
     */
    lines: 0,
    /** Character size range. Stands in for stroke weight; wide, for varied heft. */
    sizeMin: 9,
    sizeMax: 21,
    /**
     * Where the cover beneath the streaks begins; it reaches full at `flashTo`.
     * It exists to mask the canvas-to-hero swap, so it has to be fully opaque
     * before the hand-off — the lines alone are transparent and would let the
     * swap show through. Dark rather than light (see warp.ts), so this reads as
     * a dip to black on the way in.
     */
    /* Aligned with impactAt: the dip to black begins the moment the ball
       strikes the surface, not a beat after — the impact is what fades you. */
    washFrom: 0.945,
    /**
     * Settle after the landing — how long the streaks take to clear. Kept brisk:
     * the ball's entry splash plays on the bare hero immediately after, and a
     * slow decay here sits on top of it.
     */
    settleMs: 240,
    /** Bail-out when the reader breaks orbit back up the page. Deliberately brisk. */
    exitMs: 200,
  },

  /**
   * Point of no return. Set to the flash start so the white-out can never be a
   * resting state — once the screen begins going white the page takes the wheel,
   * blocks input, and flies to the hero.
   */
  commitAt: 0.90,
  /*
   * Restored to the pace the dive was composed at. This drives progress, and
   * progress drives the ball, so shortening it fast-forwards the crash itself —
   * the dead time the commit used to carry lived in the hand-off tail, and
   * commitSmoothing + the flashTo release removed it without touching speed.
   */
  commitDuration: 800,
  /**
   * Scroll back above this to re-arm the commit. Deliberately just below
   * `commitAt` rather than reusing the auto-advance's far lower threshold: a
   * reader who backs out of the flash band should be committed again on the way
   * down, but one who only nudges up *within* it should be left alone rather
   * than yanked back to the hero.
   */
  commitRearmAt: 0.88,
  /**
   * Input stays blocked for this long after landing. A trackpad fling keeps
   * emitting momentum events well after the gesture ends, and without this they
   * carry the reader straight past the hero into the section below.
   */
  landSettleMs: 600,

  /**
   * Leaving the hero back into the flight. Upward scroll at the top of the hero
   * is held and has to be worked at, rather than dropping the reader straight
   * back into the white-out they just came through.
   */
  exit: {
    /** One press of an upward scroll key counts as this much upward travel. */
    keyStep: 190,
    /**
     * How far back down the reader must scroll before the break-orbit button is
     * withdrawn again. Generous on purpose: it should not vanish from under a
     * cursor already moving toward it, so anything short of genuinely leaving the
     * top of the hero keeps it on screen.
     */
    offerHideBelow: 160,
    /**
     * How long the button stays up after the last upward push, ms.
     *
     * The hover and focus guards in scrollIntro are what make a timer safe here:
     * without them this is exactly the control that vanishes from under a cursor
     * already moving toward it. Short: long enough to read and reach, and any
     * further push restarts the clock anyway.
     */
    offerMs: 2200,
  },

  /**
   * Once the flight is mostly done, the page flies the rest of the path itself
   * and lands on the hero, rather than making the reader grind out the tail.
   */
  autoAdvance: true,
  /** Progress that triggers the assisted landing. */
  autoAdvanceAt: 0.76,
  /** Duration of the assisted landing, ms. Long enough that it reads as a swoop. */
  autoAdvanceDuration: 2600,
  /**
   * Scroll back below this to re-arm. Once the reader takes the wheel — by
   * scrolling during the landing — it stays off until they come back down here,
   * so it never repeatedly grabs someone who wants to browse the tail manually.
   */
  autoAdvanceRearmAt: 0.6,
} as const
