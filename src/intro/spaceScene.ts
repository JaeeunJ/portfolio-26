import * as THREE from 'three'
import { CONFIG, PALETTE, SPACE } from './config'
import { createStreaks } from './streaks'

/*
 * The flight path and everything scattered around it. No GLB, no textures — all
 * geometry is generated here, which is exactly what the ASCII pass lets us get
 * away with. At ~10px cells you cannot resolve a polygon, so a 2-subdivision
 * icosahedron reads identically to a sculpted asset.
 */

const WORLD_UP = new THREE.Vector3(0, 1, 0)

/*
 * Spline the camera and the ball both ride.
 *
 * Lateral weave is roughly half what it was. The bodies are placed relative to
 * this curve, so straightening it keeps every flyby intact while making the
 * route read as a line rather than a slalom.
 */
const PATH_POINTS = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(4, 2, -60),
  new THREE.Vector3(-5, -1, -125),
  new THREE.Vector3(3, 4, -190),
  new THREE.Vector3(8, -2, -255),
  new THREE.Vector3(-4, -5, -325),
  new THREE.Vector3(-2, 3, -400),
  new THREE.Vector3(5, 6, -480),
  new THREE.Vector3(1, 1, -560),
]

type PlanetShape = 'sphere' | 'cat' | 'book' | 'heart' | 'cursor' | 'hardhat'

interface PlanetSpec {
  /** Where along the path it sits. */
  t: number
  /** Lateral offset from the path, in world units. Negative = other side. */
  side: number
  /** Vertical offset from the path. */
  lift: number
  radius: number
  color: string
  /** Icosahedron subdivisions for spheres. 0 = very faceted, 2 = nearly smooth. */
  detail?: number
  ring?: boolean
  /** Ring colour. Defaults to the pale portfolio blue. */
  ringColor?: string
  shape?: PlanetShape
  /** Extra yaw applied after turning to face the path, in radians. Shaped bodies only. */
  yawOffset?: number
  /** How far back along the path a shaped body turns to face. Larger = turns more toward the approach. */
  faceBack?: number
}

/*
 * Colours skew to the bright half of the palette. The dark navies read as empty
 * space once the luminance floor kicks in — a planet needs a genuinely lit side
 * to produce the #%@ end of the ramp, which is what makes it read as a sphere.
 *
 * The three shaped bodies sit closer to the path and run larger than the
 * spheres: a silhouette only reads as "cat" or "cursor" if it covers enough
 * character cells to resolve its outline.
 */
/*
 * The bodies carry all the colour in the frame — deep saturated hues against a
 * muted blue field. The frustum shows roughly three consecutive bodies at any
 * point in the flight, so hues are assigned so every such window spans the
 * warm / pink / cool families — consecutive-only variety still produced
 * all-gold-and-violet views. Some slots are pinned by their role: the teal
 * opener under the pink title, the rose heart, the blue cursor, the brown
 * Saturn, the construction-gold hard hat.
 */
const PLANETS: PlanetSpec[] = [
  // First body you see, high on the right. Kept cool — the title card's pink
  // chrome sits over this frame, and a warm planet fought it for the eye.
  { t: 0.08, side: 30, lift: 4, radius: 13, color: SPACE.teal, detail: 1, ring: true },
  { t: 0.15, side: -24, lift: -10, radius: 8, color: SPACE.amber, detail: 0 },
  // Large body low on the left at the opening.
  // Lateral offset is a trade, not a free dial: too close and it fills the frame
  // at the flyby, too far and the frustum crops it for its whole window. This
  // sits where it reads at full size through the approach.
  { t: 0.23, side: -46, lift: 14, radius: 18, color: SPACE.magenta, detail: 1 },
  // Beside the large sphere on the right. The cursor leads the shaped bodies:
  // the nameplates introduce the pilot in a deliberate order — online first,
  // bookworm second, engineer last — so the cursor and the book swapped slots.
  { t: 0.33, side: 26, lift: -12, radius: 19, color: PALETTE.soft, shape: 'cursor' },
  { t: 0.41, side: 50, lift: 20, radius: 26, color: SPACE.gold, detail: 2 },
  { t: 0.49, side: -28, lift: 4, radius: 13, color: SPACE.rose, detail: 0 },
  { t: 0.57, side: 46, lift: 8, radius: 16, color: SPACE.violet, shape: 'book', yawOffset: 0.3 },
  // Deep enough in the flight that it is well past the opening frame.
  { t: 0.65, side: -46, lift: -18, radius: 20, color: SPACE.rose, shape: 'heart', faceBack: 0.15 },
  // The brown Saturn with its ochre ring, moved deep into the flight — well
  // clear of the title card's pink.
  { t: 0.72, side: 34, lift: -8, radius: 15, color: SPACE.umber, detail: 1, ring: true, ringColor: SPACE.ochre },
  { t: 0.80, side: -52, lift: 8, radius: 20, color: SPACE.gold, shape: 'hardhat' },
  { t: 0.88, side: 40, lift: 22, radius: 20, color: SPACE.teal, detail: 2 },
  { t: 0.95, side: -32, lift: -6, radius: 14, color: PALETTE.accent, detail: 1 },
]

/** Faint drifting backdrop so empty space still has ASCII texture instead of dead black. */
const NEBULA_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  varying vec3 vPosition;
  uniform vec3 uNear;
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform vec3 uColC;
  uniform float uTime;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
          mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
          mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }

  void main() {
    vec3 p = normalize(vPosition);
    float n = noise(p * 3.0 + vec3(0.0, 0.0, uTime * 0.02)) * 0.6
            + noise(p * 7.0 - vec3(uTime * 0.015, 0.0, 0.0)) * 0.3
            + noise(p * 15.0) * 0.1;
    // Steep ramp so only the peaks of the noise clear the ASCII luminance floor.
    // A gentle gradient here would haze the entire frame with '.' and kill the
    // negative space the composition depends on.
    //
    // The peaks themselves are hued by a second, larger noise channel — one
    // region of sky glows teal, another magenta, another amber, the way a
    // deep-field exposure separates gases — instead of every peak being the
    // same slate.
    float h = noise(p * 1.7 + vec3(19.0, 7.0, 3.0));
    vec3 peak = mix(mix(uColA, uColB, clamp(h * 2.0, 0.0, 1.0)), uColC, clamp(h * 2.0 - 1.0, 0.0, 1.0));
    gl_FragColor = vec4(mix(uNear, peak, smoothstep(0.58, 0.95, n)), 1.0);
  }
`

/*
 * Earth. Continents come from thresholded noise rather than a texture, so it
 * stays in keeping with the rest of the scene — nothing here loads an asset.
 *
 * The threshold is deliberately hard: the ASCII pass needs land and ocean to
 * land on clearly different ramp characters, and a soft coastline just blurs
 * into one tone. Diffuse is computed by hand so the terminator survives too —
 * the sphere has to read as a sphere, not a flat disc of blotches.
 */
const EARTH_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  varying vec3 vWorldNormal;
  varying vec3 vLocal;
  uniform vec3 uOcean;
  uniform vec3 uLand;
  uniform vec3 uLightDirection;
  uniform float uReveal;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
          mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
          mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }

  void main() {
    vec3 p = normalize(vLocal);
    float n = noise(p * 2.1) * 0.6 + noise(p * 4.7) * 0.28 + noise(p * 9.3) * 0.12;
    float land = smoothstep(0.50, 0.55, n);

    vec3 albedo = mix(uOcean, uLand, land);
    float diffuse = max(dot(normalize(vWorldNormal), normalize(uLightDirection)), 0.0);
    // Scaling the colour rather than using alpha keeps it opaque — no blend
    // ordering to worry about, and the ASCII luminance floor blanks it cleanly
    // as it darkens toward nothing.
    gl_FragColor = vec4(albedo * (0.18 + 1.05 * diffuse) * uReveal, 1.0);
  }
`

const EARTH_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const NEBULA_VERTEX_SHADER = /* glsl */ `
  varying vec3 vPosition;
  void main() {
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/** Soft radial dot so a star covers a cell or two rather than vanishing. */
function createStarSprite(): THREE.CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  // Tight falloff on purpose: a star should land inside one character cell and
  // read as a single '.' or '*'. A soft halo smears across neighbours and the
  // Sobel pass turns each one into a ring of slashes.
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.85)')
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.12)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  return texture
}

/**
 * Hard-edged pixel cross for the sparkle stars — the 8-bit twinkle. Drawn as
 * discrete square "pixels" with stepped alpha down the arms, no gradients, and
 * sampled with nearest filtering so the steps survive onto the screen. An odd
 * pixel grid so the cross centres exactly.
 */
function createSparkleSprite(): THREE.CanvasTexture {
  const grid = 7
  const px = 9
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = grid * px
  const ctx = canvas.getContext('2d')!

  const put = (cx: number, cy: number, alpha: number) => {
    ctx.fillStyle = `rgba(255,255,255,${alpha})`
    ctx.fillRect(cx * px, cy * px, px, px)
  }

  put(3, 3, 1)
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    put(3 + dx, 3 + dy, 0.8)
    put(3 + dx * 2, 3 + dy * 2, 0.5)
    put(3 + dx * 3, 3 + dy * 3, 0.26)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.generateMipmaps = false
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  return texture
}

/**
 * Teardrop aura: a round bulb that tapers to a point, built by stacking soft
 * radial gradients of shrinking radius and alpha along the vertical axis.
 *
 * Drawn with the bulb at the bottom and the tip at the top, so an unrotated
 * sprite points its tail straight up. The caller anchors the sprite at the bulb
 * (`center`) and rotates it to trail the direction of travel.
 */
function createAuraSprite(): THREE.CanvasTexture {
  const width = 128
  const height = 256
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')!
  // Accumulate rather than paint over, so the overlapping blobs merge into one
  // continuous falloff instead of banding.
  ctx.globalCompositeOperation = 'lighter'

  const BULB_V = 0.78
  const TIP_V = 0.06
  const steps = 56

  for (let i = 0; i < steps; i++) {
    const s = i / (steps - 1)
    const y = height * (BULB_V - s * (BULB_V - TIP_V))
    const radius = width * 0.36 * Math.pow(1 - s, 1.5)
    // Falloff is deliberately flat. The ASCII pass blanks any cell below its
    // luminance floor, so a natural-looking exponential tail simply disappears
    // and the aura collapses to a round blob. These numbers keep roughly the
    // first 60% of the taper above that floor.
    const alpha = 0.62 * Math.pow(1 - s, 1.2)
    if (radius < 0.5) continue

    const gradient = ctx.createRadialGradient(width / 2, y, 0, width / 2, y, radius)
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`)
    gradient.addColorStop(0.45, `rgba(255,255,255,${alpha * 0.34})`)
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  return texture
}

/** Round halo that always surrounds the ball, independent of the tail. */
function createHaloSprite(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)')
  gradient.addColorStop(0.22, 'rgba(255,255,255,0.45)')
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.12)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  return texture
}

/**
 * Sprite-space v of the aura's bulb.
 *
 * BULB_V above is measured DOWN the canvas, but `Sprite.center` is in sprite UV
 * space with its origin at the lower left — and CanvasTexture defaults to
 * flipY: true. So the two are complements, not the same number. Anchoring at
 * 0.78 puts the ball at the tip and throws the glow off to one side.
 */
const AURA_BULB_SPRITE_V = 1 - 0.78

/**
 * Scatters points in a tube around the path so stars stay in frame for the whole
 * flight instead of clustering near the origin.
 */
function createPointField(
  curve: THREE.CatmullRomCurve3,
  count: number,
  radiusMin: number,
  radiusMax: number,
  sprite: THREE.CanvasTexture,
  size: number,
  color: string,
  opacity: number,
  /** Per-point palette. When given, each point picks one at random. */
  colors?: readonly string[],
): THREE.Points {
  const positions = new Float32Array(count * 3)
  const point = new THREE.Vector3()

  for (let i = 0; i < count; i++) {
    curve.getPointAt(Math.random(), point)
    const angle = Math.random() * Math.PI * 2
    const radius = radiusMin + Math.random() * (radiusMax - radiusMin)
    positions[i * 3 + 0] = point.x + Math.cos(angle) * radius
    positions[i * 3 + 1] = point.y + Math.sin(angle) * radius * 0.7
    positions[i * 3 + 2] = point.z + (Math.random() - 0.5) * 60
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  if (colors) {
    const tints = new Float32Array(count * 3)
    const tint = new THREE.Color()
    for (let i = 0; i < count; i++) {
      tint.set(colors[Math.floor(Math.random() * colors.length)])
      tints[i * 3 + 0] = tint.r
      tints[i * 3 + 1] = tint.g
      tints[i * 3 + 2] = tint.b
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(tints, 3))
  }

  const material = new THREE.PointsMaterial({
    size,
    map: sprite,
    color: new THREE.Color(color),
    vertexColors: Boolean(colors),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  })

  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  return points
}

/* --- shaped bodies -------------------------------------------------------
 * Each builder returns a Group whose local +Z is its "front". The caller only
 * sets group.rotation.y, so these stay upright however the path curves.
 */

export function buildCatBody(radius: number, material: THREE.Material): THREE.Group {
  const group = new THREE.Group()
  group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 2), material))

  group.add(...buildCatEars(radius, material))
  return group
}

/**
 * Ears as lathed profiles rather than cones, so the tip can carry a fillet.
 * A plain cone terminates in a hard point that reads as a spike at this
 * resolution; rounding the last ~13% of the height softens it while keeping the
 * triangular silhouette.
 *
 * Tall and narrow on purpose — ears only register if they break the sphere's
 * outline by a clear margin.
 */
function buildCatEars(radius: number, material: THREE.Material): THREE.Mesh[] {
  // The base-to-fillet ratio is what separates "cat" from "rabbit". Narrowing to
  // only ~40% of the base over a tall ear reads as a rounded rod; it needs to
  // taper to near a point, with the fillet just knocking the spike off the tip.
  const height = radius * 1.05
  const base = radius * 0.4
  const fillet = radius * 0.075

  const profile: THREE.Vector2[] = [new THREE.Vector2(base, 0), new THREE.Vector2(fillet, height - fillet)]
  const arcSteps = 4
  for (let i = 1; i <= arcSteps; i++) {
    const angle = (i / arcSteps) * (Math.PI / 2)
    profile.push(
      new THREE.Vector2(fillet * Math.cos(angle), height - fillet + fillet * Math.sin(angle)),
    )
  }

  // Few radial segments keeps the faceted look that matches the flat-shaded body.
  const geometry = new THREE.LatheGeometry(profile, 6)

  return [-1, 1].map((sign) => {
    const ear = new THREE.Mesh(geometry, material)
    ear.position.set(sign * radius * 0.54, radius * 0.86, 0)
    ear.rotation.z = -sign * 0.28
    ear.rotation.y = Math.PI / 6
    return ear
  })
}

/**
 * An open book, seen roughly down its spine: two halves hinged into a V with
 * bright page blocks sitting on their inner faces.
 *
 * The page/cover contrast is doing the work — a single-material book collapses
 * into an anonymous wedge at this resolution, whereas a bright block inset on a
 * darker slab reads as pages between covers.
 */
export function buildBookBody(radius: number, material: THREE.Material): THREE.Group {
  const inner = new THREE.Group()

  const span = radius * 1.3
  const depth = radius * 1.15
  const coverThickness = radius * 0.1
  const pageThickness = radius * 0.07
  // Steep splay. At 0.52 the halves sat only 30° off horizontal and the book
  // read as a flat plank; the butterfly silhouette needs the arms well up.
  const openAngle = 1.0

  // Emissive, not just white: the pages face into the V and catch little of the
  // key light, so lit-only they land on the same ramp characters as the covers
  // and the two read as one mass.
  const pageMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.white),
    emissive: new THREE.Color(PALETTE.pale),
    emissiveIntensity: 0.45,
    flatShading: true,
    roughness: 0.9,
    side: THREE.DoubleSide,
  })

  for (const sign of [-1, 1]) {
    const half = new THREE.Group()

    const cover = new THREE.Mesh(new THREE.BoxGeometry(span, coverThickness, depth), material)
    cover.position.x = (sign * span) / 2
    half.add(cover)

    // Inset slightly so the cover reads as a border around the pages. Local +y
    // is the inner face of the V for both halves once they are hinged.
    const pages = new THREE.Mesh(
      new THREE.BoxGeometry(span * 0.88, pageThickness, depth * 0.88),
      pageMaterial,
    )
    pages.position.set(
      (sign * span) / 2 - sign * span * 0.04,
      (coverThickness + pageThickness) / 2,
      0,
    )
    half.add(pages)

    half.rotation.z = sign * openAngle
    inner.add(half)
  }

  // The V opens along +Y with its spine along +Z, and yaw aims +Z at the flight
  // path — so the spine recedes from the viewer and the two halves splay left
  // and right. That is the silhouette we want. A small positive tilt tips the
  // opening toward the viewer so the bright page faces catch light too.
  inner.rotation.x = 0.5
  inner.rotation.z = 0.1

  const group = new THREE.Group()
  group.add(inner)
  return group
}

/**
 * Geometric 3D heart: a cube stood on one corner with a ball seated on each of
 * the two upper faces.
 *
 * Built from the same faceted primitives as the planets so it reads as part of
 * the same family. The extruded bezier outline this replaces was a rounded slab
 * — correct in silhouette but flat, and smooth where everything around it is
 * hard-edged.
 */
export function buildHeartBody(radius: number, material: THREE.Material): THREE.Group {
  // Single extruded outline rather than a cube with two balls stuck on it. The
  // composite version had no cleft between the lobes and no continuous curve
  // from lobe down to point — it read as exactly what it was, a box with bumps.
  // Only a real heart outline gives both.
  const shape = new THREE.Shape()
  shape.moveTo(0.5, 0.5)
  shape.bezierCurveTo(0.5, 0.5, 0.4, 0, 0, 0)
  shape.bezierCurveTo(-0.6, 0, -0.6, 0.7, -0.6, 0.7)
  shape.bezierCurveTo(-0.6, 1.1, -0.3, 1.54, 0.5, 1.9)
  shape.bezierCurveTo(1.2, 1.54, 1.6, 1.1, 1.6, 0.7)
  shape.bezierCurveTo(1.6, 0.7, 1.6, 0, 1.0, 0)
  shape.bezierCurveTo(0.7, 0, 0.5, 0.5, 0.5, 0.5)

  // bevelSize is the critical number, and it is not a free "roundness" dial.
  // The bevel rounds concavities as well as edges, and the cleft between the
  // lobes is only 0.5 deep in this outline — at 0.3 the cleft is rounded away
  // entirely and the whole thing collapses into a blob. 0.08 keeps the cleft
  // and the bottom point while still chamfering the edge.
  //
  // Volume comes from depth, and the geometric look from a single bevel segment
  // plus coarse curve tessellation — not from a fatter bevel.
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1.0,
    bevelEnabled: true,
    bevelSize: 0.08,
    bevelThickness: 0.12,
    bevelSegments: 1,
    curveSegments: 12,
  })
  geometry.center()
  geometry.computeBoundingBox()
  const size = new THREE.Vector3()
  geometry.boundingBox!.getSize(size)
  const scale = (radius * 2) / size.y
  geometry.scale(scale, scale, scale)

  const inner = new THREE.Group()
  const mesh = new THREE.Mesh(geometry, material)
  // Outline is authored lobes-down, point-up; flip it for three's y-up.
  mesh.rotation.z = Math.PI
  inner.add(mesh)

  // Separate node for the pose, so the corner-down roll above stays independent
  // of it.
  //
  // Kept close to face-on deliberately. A heart is far more yaw-sensitive than
  // the other shapes: past roughly ±0.4 the cleft stops reading and it collapses
  // into a lumpy blob. An earlier 0.4 turn here — meant to show off the depth —
  // stacked with the camera's dutch roll and did exactly that. Depth comes from
  // the faceting instead.
  const pose = new THREE.Group()
  pose.rotation.set(-0.1, 0.12, 0)
  pose.add(inner)

  const group = new THREE.Group()
  group.add(pose)
  return group
}

export function buildCursorBody(radius: number, material: THREE.Material): THREE.Group {
  // Classic arrow pointer traced tip-first, y running downward.
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(0, -1.9)
  shape.lineTo(0.45, -1.45)
  shape.lineTo(0.78, -2.2)
  shape.lineTo(1.15, -2.02)
  shape.lineTo(0.83, -1.3)
  shape.lineTo(1.42, -1.22)
  shape.closePath()

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.42,
    bevelEnabled: true,
    bevelSize: 0.07,
    bevelThickness: 0.07,
    bevelSegments: 2,
  })
  geometry.center()
  const scale = (radius * 2) / 2.2
  geometry.scale(scale, scale, scale)

  const group = new THREE.Group()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.z = 0.22
  group.add(mesh)
  return group
}

export function buildHardHatBody(radius: number, material: THREE.Material): THREE.Group {
  const inner = new THREE.Group()

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    material,
  )
  inner.add(dome)

  // A peak on the front only, not a lip all the way round. A full ring reads as
  // a sun hat from any angle; a single projecting peak is what makes it a hard
  // hat.
  //
  // CylinderGeometry lays theta out with 0 at +Z and PI/2 at +X, so 0..PI is the
  // half containing +X. Pointing the peak sideways rather than forward matters:
  // yaw aims +Z at the flight path, so a forward peak is foreshortened straight
  // at the viewer and collapses into a band under the dome. Sideways, it stays
  // in profile and reads as a peak.
  const brim = new THREE.Mesh(
    new THREE.CylinderGeometry(
      radius * 1.38,
      radius * 1.38,
      radius * 0.08,
      24,
      1,
      false,
      0,
      Math.PI,
    ),
    material,
  )
  brim.scale.x = 1.15
  inner.add(brim)

  // The ridge along the crown is the detail that makes it read as a hard hat
  // rather than a plain dome.
  //
  // A box will not do: at the crown height the dome is only ~1r across, so a
  // box long enough to look like a ridge juts out past the silhouette as a
  // wedge. A thin slice of a slightly larger hemisphere follows the dome's
  // curve instead, sitting just proud of it the whole way front to back.
  const crest = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.05, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    material,
  )
  crest.scale.set(0.09, 1.07, 1.0)
  inner.add(crest)

  // Slight tilt for a three-quarter view. Any more and the brim foreshortens
  // into the dome and the whole thing reads as a blob.
  inner.rotation.x = -0.12
  inner.rotation.z = 0.05

  const group = new THREE.Group()
  group.add(inner)
  return group
}

/**
 * A body the flight labels as it passes — the HUD tags that introduce the
 * pilot. The DOM side (scrollIntro) projects the object's world position each
 * frame; all the scene provides is the anchor and how big the body is, so the
 * tag can sit above its silhouette rather than on it.
 */
export interface TagAnchor {
  key: string
  object: THREE.Object3D
  /**
   * Height of the body's own silhouette above its origin, in world units.
   *
   * Measured from the built geometry rather than taken from `radius`: the
   * shaped bodies are not spheres and do not fill their nominal radius the
   * same way. The book's splayed halves reach well above it while the cursor
   * and hard hat sit mostly below their origin — so a single radius-based
   * offset planted the cursor's and the hat's labels far above the thing they
   * were pointing at. Yaw is the only rotation applied, and yaw does not
   * change vertical extent, so one measurement holds for the whole flight.
   */
  topY: number
  t: number
  /**
   * The body's materials, whose shared opacity IS its materialize-on-approach
   * fade. The bubble must not speak about a body the reader has not seen yet,
   * so its open is gated on this reaching full.
   */
  materials: THREE.Material[]
}

export interface SpaceScene {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** The shooting star the reader rides beside — the thinker of the flyby thoughts. */
  ball: THREE.Object3D
  /** The shaped bodies that trigger flyby thoughts: book, cursor, hard hat. */
  tagAnchors: TagAnchor[]
  /**
   * @param progress 0..1 along the flight. @param elapsed ms since start.
   * @param drama 0..1 — floods the streak field regardless of scroll speed.
   *   The slow-mo pass drives this: the world whooshing past while the reader
   *   hangs in the moment is what sells the bullet time.
   */
  update(progress: number, elapsed: number, drama?: number): void
  setAspect(aspect: number): void
  dispose(): void
}

export function createSpaceScene(aspect: number): SpaceScene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(PALETTE.void)

  const camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 3000)
  const curve = new THREE.CatmullRomCurve3(PATH_POINTS, false, 'catmullrom', 0.4)

  // --- backdrop ------------------------------------------------------------
  const nebulaMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uNear: { value: new THREE.Color(PALETTE.void) },
      uColA: { value: new THREE.Color(PALETTE.slate) },
      uColB: { value: new THREE.Color(PALETTE.slate).multiplyScalar(0.55) },
      uColC: { value: new THREE.Color(PALETTE.accent).multiplyScalar(0.35) },
      uTime: { value: 0 },
    },
    vertexShader: NEBULA_VERTEX_SHADER,
    fragmentShader: NEBULA_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
  })
  const nebula = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 24), nebulaMaterial)
  nebula.frustumCulled = false
  scene.add(nebula)

  // --- stars & dust --------------------------------------------------------
  // Three star populations, all in the site's blues. The dot fields carry the
  // depth, and a sparse layer of pixel-cross sparkles carries the 8-bit read.
  const sprite = createStarSprite()
  const sparkleSprite = createSparkleSprite()
  const stars = createPointField(curve, 720, 90, 520, sprite, 1.9, PALETTE.soft, 0.8)
  const dimStars = createPointField(curve, 330, 90, 520, sprite, 1.9, PALETTE.accent, 0.55)
  const dust = createPointField(curve, 170, 26, 120, sprite, 0.8, PALETTE.accent, 0.4)
  // Background texture, not features: small, dim, and the same muted blue as
  // everything around them, so only the nearest few resolve a faint cross in
  // mid-ramp glyphs. Anything brighter reads as foreground objects.
  const sparkles = createPointField(curve, 70, 70, 460, sparkleSprite, 5, PALETTE.white, 0.3, [
    PALETTE.soft,
    PALETTE.soft,
    PALETTE.accent,
  ])
  scene.add(stars, dimStars, dust, sparkles)

  // --- planets -------------------------------------------------------------
  const spinners: THREE.Mesh[] = []
  const rings: THREE.Mesh[] = []
  const featured: THREE.Group[] = []
  /*
   * Shaped bodies materialize on approach rather than sitting visible from the
   * opening frame — a distant book or cursor silhouette gives the gag away and
   * reads as clutter. Spheres are exempt: a far-off planet is just scenery.
   */
  const reveals: { group: THREE.Group; t: number; materials: THREE.Material[] }[] = []
  /*
   * Everything placed for one spec, kept together so the clearance pass below
   * can move a body without leaving its ring behind.
   */
  const placed: { spec: PlanetSpec; right: THREE.Vector3; parts: THREE.Object3D[] }[] = []
  /* The three bodies that say something about the pilot get flyby tags. The
     anchor is the GROUP, not the spec position — the clearance pass below may
     still move a body, and the tag has to move with it. */
  const tagAnchors: TagAnchor[] = []
  const tangent = new THREE.Vector3()
  const right = new THREE.Vector3()
  const anchor = new THREE.Vector3()
  const faceAnchor = new THREE.Vector3()

  for (const spec of PLANETS) {
    curve.getPointAt(spec.t, anchor)
    curve.getTangentAt(spec.t, tangent)
    right.crossVectors(tangent, WORLD_UP).normalize()

    // DoubleSide keeps the open-bottomed hard-hat dome from showing through.
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(spec.color),
      flatShading: true,
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.DoubleSide,
    })

    const position = anchor.clone().addScaledVector(right, spec.side)
    position.y += spec.lift

    const parts: THREE.Object3D[] = []

    if (spec.shape && spec.shape !== 'sphere') {
      const builders = {
        cat: buildCatBody,
        book: buildBookBody,
        heart: buildHeartBody,
        cursor: buildCursorBody,
        hardhat: buildHardHatBody,
      }
      const group = builders[spec.shape](spec.radius, material)

      group.position.copy(position)
      // Yaw only, so the silhouette stays upright.
      //
      // Aimed at a point BACK along the path rather than at the body's own
      // anchor. Facing the anchor points the body perpendicular to the route, so
      // the effective yaw grows as the camera closes in — by the flyby the body
      // is edge-on. Facing where the viewer actually is while it reads keeps it
      // presented to them.
      curve.getPointAt(Math.max(spec.t - (spec.faceBack ?? 0.09), 0), faceAnchor)
      group.rotation.y =
        Math.atan2(faceAnchor.x - position.x, faceAnchor.z - position.z) + (spec.yawOffset ?? 0)
      scene.add(group)
      featured.push(group)
      parts.push(group)

      // Collect every material in the group (body + the book's pages) so the
      // whole silhouette fades as one. Duplicates from shared materials are
      // harmless — opacity is just written twice.
      const materials: THREE.Material[] = []
      group.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          const nodeMaterial = node.material as THREE.Material
          nodeMaterial.transparent = true
          nodeMaterial.opacity = 0
          materials.push(nodeMaterial)
        }
      })
      reveals.push({ group, t: spec.t, materials })

      if (spec.shape === 'book' || spec.shape === 'cursor' || spec.shape === 'hardhat') {
        // Local box: the group is already positioned, so a world box would
        // fold the position back in and the offset would double.
        const box = new THREE.Box3()
        group.children.forEach((child) => box.expandByObject(child))
        tagAnchors.push({
          key: spec.shape,
          object: group,
          topY: Number.isFinite(box.max.y) ? box.max.y : spec.radius,
          t: spec.t,
          // The reveal fade drives these; the speech bubble reads the first
          // one so it can wait for the body to actually be on screen.
          materials,
        })
      }
    } else {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(spec.radius, spec.detail ?? 1),
        material,
      )
      mesh.position.copy(position)
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0)
      scene.add(mesh)
      spinners.push(mesh)
      parts.push(mesh)
    }

    // Outside the branch on purpose: a ring is independent of body shape, so a
    // cat-eared planet can wear one too.
    if (spec.ring) {
      // Emissive in the ring's own colour, not the old slate: a self-lit tint
      // keeps a coloured ring saturated, where a grey-blue glow muddied it.
      const ringColor = new THREE.Color(spec.ringColor ?? PALETTE.pale)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(spec.radius * 1.8, spec.radius * 0.05, 6, 72),
        new THREE.MeshStandardMaterial({
          color: ringColor,
          flatShading: true,
          roughness: 0.8,
          emissive: ringColor,
          emissiveIntensity: 0.4,
        }),
      )
      ring.position.copy(position)
      ring.rotation.set(Math.PI / 2.4, 0.3, 0)
      scene.add(ring)
      rings.push(ring)
      parts.push(ring)
    }

    placed.push({ spec, right: right.clone(), parts })
  }

  // --- earth ---------------------------------------------------------------
  const EARTH = CONFIG.earth
  const endPoint = curve.getPointAt(1, new THREE.Vector3())
  const endTangent = curve.getTangentAt(1, new THREE.Vector3())
  const earthCenter = endPoint.clone().addScaledVector(endTangent, EARTH.lead)

  const earthMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uOcean: { value: new THREE.Color(PALETTE.electric) },
      uLand: { value: new THREE.Color(SPACE.leaf) },
      uLightDirection: { value: new THREE.Vector3(-1, 0.8, 0.4).normalize() },
      uReveal: { value: 0 },
    },
    vertexShader: EARTH_VERTEX_SHADER,
    fragmentShader: EARTH_FRAGMENT_SHADER,
  })
  const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH.radius, 48, 32), earthMaterial)
  earth.position.copy(earthCenter)
  scene.add(earth)

  // Where the ball buries itself. Offset from the near pole so the impact is not
  // dead centre, and pulled slightly inside the surface so it reads as embedded.
  const earthRight = new THREE.Vector3().crossVectors(endTangent, WORLD_UP).normalize()
  const earthUp = new THREE.Vector3().crossVectors(earthRight, endTangent).normalize()
  const impactDirection = new THREE.Vector3()
    .addScaledVector(endTangent, -1)
    .addScaledVector(earthRight, 0.3)
    .addScaledVector(earthUp, 0.2)
    .normalize()
  const impactPoint = earthCenter.clone().addScaledVector(impactDirection, EARTH.radius * 0.94)

  // --- the shooting star ---------------------------------------------------
  const BALL = CONFIG.ball

  const ball = new THREE.Mesh(
    new THREE.IcosahedronGeometry(BALL.radius, 3),
    // Emissive soft-blue rather than blown-out white: the ball has to stay just
    // under the luma that snaps the tint ramp to pure white, or its whole disc
    // lands on the same solid glyph and it reads as a flat cutout.
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.white),
      emissive: new THREE.Color(PALETTE.soft),
      emissiveIntensity: 1.4,
      roughness: 0.3,
      flatShading: true,
    }),
  )
  scene.add(ball)

  /*
   * The aura. Anchored at its bulb so the ball sits in the round end, and
   * rotated each frame so the taper points away from the direction of travel.
   * Sprite rotation happens in view space, so the angle is computed there too.
   */
  const AURA = BALL.aura

  const haloTexture = createHaloSprite()
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: haloTexture,
      color: new THREE.Color(PALETTE.soft),
      transparent: true,
      opacity: AURA.haloOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  halo.scale.setScalar(BALL.radius * AURA.haloScale)
  scene.add(halo)

  const auraTexture = createAuraSprite()
  const tail = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: auraTexture,
      color: new THREE.Color(PALETTE.soft),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  tail.center.set(0.5, AURA_BULB_SPRITE_V)
  const tailWidth = BALL.radius * AURA.tailWidth
  tail.scale.set(tailWidth, tailWidth * 2, 1)
  scene.add(tail)

  const ballLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 1100, 280, 2)
  scene.add(ballLight)

  const streaks = createStreaks(scene)

  // --- lighting ------------------------------------------------------------
  // Low ambient + hard key is deliberate: ASCII needs a wide luminance spread to
  // use the whole ramp. Flat lighting collapses every planet to one character.
  scene.add(new THREE.AmbientLight(new THREE.Color(PALETTE.mid), 1.2))
  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.white), 6.0)
  key.position.set(-1, 0.8, 0.4)
  scene.add(key)
  const rim = new THREE.DirectionalLight(new THREE.Color(PALETTE.accent), 2.0)
  rim.position.set(1, -0.5, -0.6)
  scene.add(rim)

  // --- per-frame -----------------------------------------------------------
  const camPos = new THREE.Vector3()
  const lookTarget = new THREE.Vector3()
  const forward = new THREE.Vector3()
  const orbitRight = new THREE.Vector3()
  const orbitUp = new THREE.Vector3()
  const previousPosition = new THREE.Vector3()
  const travelDirection = new THREE.Vector3()
  const viewHead = new THREE.Vector3()
  const viewTail = new THREE.Vector3()

  /**
   * Ball world position at an arbitrary progress value.
   *
   * Pure function of progress — no dependence on elapsed time. That keeps the
   * aura's orientation stable when the user stops scrolling, and makes scrubbing
   * back and forth exactly reproducible.
   */
  function ballPositionAt(progress: number, out: THREE.Vector3): THREE.Vector3 {
    const camT = THREE.MathUtils.clamp(progress, 0, 1) * 0.94
    const ballT = Math.min(camT + BALL.lead, 1)

    curve.getPointAt(ballT, out)
    curve.getTangentAt(ballT, tangent)
    orbitRight.crossVectors(tangent, WORLD_UP).normalize()
    orbitUp.crossVectors(orbitRight, tangent).normalize()

    const phase = progress * BALL.orbitTurns + BALL.orbitStartPhase
    const radius = BALL.orbitRadius + Math.sin(progress * Math.PI * 3) * BALL.orbitWobble
    out.addScaledVector(orbitRight, Math.cos(phase) * radius)
    out.addScaledVector(orbitUp, Math.sin(phase) * radius * BALL.verticalFactor)

    // Break out of the orbit and dive at Earth over the last stretch. Cubed so
    // it barely deviates at first and then accelerates — a fall, not a glide.
    const dive = THREE.MathUtils.clamp(
      (progress - CONFIG.crashFrom) / (CONFIG.impactAt - CONFIG.crashFrom),
      0,
      1,
    )
    if (dive > 0) out.lerp(impactPoint, dive * dive * dive)

    return out
  }

  /*
   * --- ball clearance ---
   *
   * The ball orbits the flight axis rather than riding it, so a body placed a
   * comfortable distance from the *path* is not necessarily clear of the *ball*.
   * The book was not: the ball flew straight through its open V.
   *
   * Measured rather than hand-tuned. Nudging one `side` until that one body
   * stops clipping is a fix that silently rots the next time a body is moved,
   * resized, or reshaped — and the builders make bodies substantially wider than
   * their nominal radius (the book's arms reach 1.3x it), so the numbers that
   * matter are not the ones in the spec table anyway.
   *
   * Bodies only ever move outward, along the same axis `side` is measured on, so
   * a body keeps the side of the path and the framing it was composed for.
   */
  const BALL_CLEARANCE = 7

  const ballProbe = new THREE.Vector3()
  const bodyCentre = new THREE.Vector3()
  const meshCentre = new THREE.Vector3()

  for (const { spec, right: outAxis, parts } of placed) {
    if (parts.length === 0) continue

    /*
     * Exact reach about the body's own origin, measured over vertices.
     *
     * Both cheaper approximations over-measure badly enough to matter. A Box3's
     * circumscribed sphere inflates a round body by up to sqrt(3); summing a
     * mesh's bounding-sphere offset and radius double-counts whenever that
     * sphere is itself off-centre, which is exactly the case for the hard hat's
     * half-cylinder brim. Either one shoves bodies that were never in the way
     * halfway out of frame. These are 300-500 vertex geometries measured once at
     * startup, so there is nothing to save here anyway.
     */
    parts[0].updateMatrixWorld(true)
    bodyCentre.copy(parts[0].position)
    let bodyRadius = 0
    for (const part of parts) {
      part.updateMatrixWorld(true)
      part.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return
        const position = (node.geometry as THREE.BufferGeometry).getAttribute('position')
        for (let i = 0; i < position.count; i++) {
          meshCentre.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld)
          bodyRadius = Math.max(bodyRadius, meshCentre.distanceTo(bodyCentre))
        }
      })
    }

    const needed = bodyRadius + BALL.radius + BALL_CLEARANCE

    /*
     * Progress at which the ball reaches this body's point on the path: it flies
     * BALL.lead ahead of a camera that covers 94% of the curve. Sampled over a
     * window either side rather than solved — the orbit term makes distance a
     * transcendental function of progress, and the window is what catches a body
     * the ball misses head-on but clips on the way past.
     */
    const centre = (spec.t - BALL.lead) / 0.94
    const samples: THREE.Vector3[] = []
    for (let i = 0; i <= 40; i++) {
      const progress = centre + (i / 40 - 0.5) * 0.16
      if (progress < 0 || progress > 1) continue
      samples.push(ballPositionAt(progress, ballProbe).clone())
    }

    /*
     * Iterated, because the push is along one axis while the shortfall is
     * measured along the line between the two — one step of `needed - closest`
     * always helps but can undershoot. Monotonic, so a handful converges; the
     * cap is only there so a pathological spec cannot spin here forever.
     */
    let push = 0
    for (let step = 0; step < 8; step++) {
      let closest = Infinity
      for (const sample of samples) closest = Math.min(closest, sample.distanceTo(bodyCentre))
      if (closest >= needed) break
      push += needed - closest
      bodyCentre.addScaledVector(outAxis, Math.sign(spec.side) * (needed - closest))
    }

    if (push === 0) continue
    for (const part of parts) part.position.addScaledVector(outAxis, Math.sign(spec.side) * push)
  }

  let lastProgress = 0
  let lastElapsed = 0
  let smoothedSpeed = 0

  /**
   * Halo sits on the ball unconditionally. The tail fades in and extends with
   * scroll speed, and points opposite to the screen-space direction of travel.
   */
  function updateAura(progress: number, elapsed: number): void {
    halo.position.copy(ball.position)
    tail.position.copy(ball.position)

    // Progress per second. Guard the first frame, where lastElapsed is 0 and the
    // delta is the whole page-load time.
    const deltaSeconds = (elapsed - lastElapsed) / 1000
    if (deltaSeconds > 0 && deltaSeconds < 0.5) {
      const speed = Math.abs(progress - lastProgress) / deltaSeconds
      smoothedSpeed = THREE.MathUtils.lerp(smoothedSpeed, speed, AURA.speedSmoothing)
    }
    lastProgress = progress
    lastElapsed = elapsed

    const stretch = THREE.MathUtils.clamp(smoothedSpeed / AURA.speedForFullStretch, 0, 1)
    // Ease in so a slow scroll barely elongates it and only a real scroll draws
    // it out to a point.
    const eased = stretch * stretch

    tail.material.opacity = AURA.tailOpacity * eased
    tail.scale.y =
      tailWidth * 2 * THREE.MathUtils.lerp(AURA.tailRestLength, AURA.tailMaxLength, eased)

    ballPositionAt(Math.max(progress - AURA.directionSample, 0), previousPosition)
    viewHead.copy(ball.position).applyMatrix4(camera.matrixWorldInverse)
    viewTail.copy(previousPosition).applyMatrix4(camera.matrixWorldInverse)

    const dx = viewTail.x - viewHead.x
    const dy = viewTail.y - viewHead.y
    // Near progress 0, or when travelling straight down the view axis, the
    // screen-space direction is degenerate — hold the last angle rather than
    // letting the tail snap around.
    if (dx * dx + dy * dy > 1e-6) {
      tail.material.rotation = Math.atan2(-dx, dy)
    }
  }

  function update(progress: number, elapsed: number, drama = 0): void {
    const t = THREE.MathUtils.clamp(progress, 0, 1)
    // Stop short of 1.0 so the look-ahead and ball offsets stay on the curve.
    const camT = t * 0.94

    curve.getPointAt(camT, camPos)
    curve.getPointAt(Math.min(camT + 0.035, 1), lookTarget)

    // Camera first — the aura reads its orientation from the view matrix, so
    // that matrix must already reflect this frame.
    camera.position.copy(camPos)
    forward.copy(lookTarget).sub(camPos).normalize()
    // Dutch roll: oscillates through the flight and drifts, so consecutive
    // beats never repeat the same horizon angle.
    const roll = Math.sin(t * Math.PI * 2 * CONFIG.rollCycles) * CONFIG.maxRoll + t * 0.12
    camera.up.set(0, 1, 0).applyAxisAngle(forward, roll)
    camera.lookAt(lookTarget)
    camera.updateMatrixWorld()

    ballPositionAt(t, ball.position)
    ball.rotation.x = elapsed * 0.0004
    ball.rotation.y = elapsed * 0.0006
    ballLight.position.copy(ball.position)
    updateAura(t, elapsed)
    // After camera.updateMatrixWorld() above — streaks are built in the camera's
    // basis and would trail a frame behind otherwise. The curve tangent is the
    // direction of travel, which is what the streaks radiate from; it is close
    // to but not the same as the look direction, so the vanishing point drifts
    // off screen centre through the turns.
    curve.getTangentAt(camT, travelDirection)
    // Same smoothed scroll speed the aura reads (updateAura ran above, so it is
    // current for this frame), saturating a little earlier than the tail does —
    // the streaks should answer a gentle scroll, not only a fling.
    const activity = THREE.MathUtils.clamp(
      smoothedSpeed / (AURA.speedForFullStretch * 0.6),
      0,
      1,
    )
    /* Drama overrides quiet: in slow-mo the scroll is crawling, so the
       speed-derived activity would go dark at exactly the moment the frame
       should be full of motion. The boost keeps every cycling streak lit. */
    streaks.update(t, elapsed * 0.001, camera, travelDirection, Math.min(1, activity + drama))

    for (let i = 0; i < spinners.length; i++) {
      spinners[i].rotation.y += 0.0009 + i * 0.00004
    }
    for (const ring of rings) {
      ring.rotation.z += 0.0004
    }
    // Shaped bodies bob instead of spinning — a full rotation would hide the
    // ears/arrow/brim for most of the pass.
    for (let i = 0; i < featured.length; i++) {
      featured[i].position.y += Math.sin(elapsed * 0.0004 + i) * 0.006
    }
    // Fade each shaped body in over the approach: invisible until the camera
    // is ~0.3 of the path away, fully there well before its flyby. The ASCII
    // luma floor sharpens the low end for free — a body below the floor
    // renders as nothing, so it materializes out of the dark rather than
    // ghosting at 10% opacity.
    for (const reveal of reveals) {
      const fade = THREE.MathUtils.smoothstep(camT, reveal.t - 0.3, reveal.t - 0.14)
      reveal.group.visible = fade > 0.001
      for (const material of reveal.materials) material.opacity = fade
    }

    // Fully hidden rather than merely black before the reveal: an unlit sphere
    // still writes depth, so it would punch a starless hole in the field.
    const reveal = THREE.MathUtils.smoothstep(t, EARTH.revealFrom, EARTH.revealTo)
    earth.visible = reveal > 0.001
    earthMaterial.uniforms.uReveal.value = reveal
    earth.rotation.y = elapsed * CONFIG.earth.spin

    nebulaMaterial.uniforms.uTime.value = elapsed * 0.001
    nebula.position.copy(camPos)
  }

  function setAspect(nextAspect: number): void {
    camera.aspect = nextAspect
    camera.updateProjectionMatrix()
  }

  function dispose(): void {
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        object.geometry.dispose()
        const material = object.material
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material.dispose()
      }
    })
    streaks.dispose()
    sprite.dispose()
    sparkleSprite.dispose()
    auraTexture.dispose()
    haloTexture.dispose()
  }

  return { scene, camera, ball, tagAnchors, update, setAspect, dispose }
}
