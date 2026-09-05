import * as THREE from 'three'
import { CONFIG, PALETTE } from './config'

/*
 * Three-pass GPU ASCII pipeline. Nothing ever leaves the GPU, which is the
 * whole reason this holds 60fps where the classic readPixels-into-a-<pre>
 * approach falls over.
 *
 *   Pass A  scene   -> sceneRT   (cells * SUPERSAMPLE)   normal 3D render, tiny
 *   Pass B  sceneRT -> cellRT    (cells)                 box-average + sobel,
 *                                                        packs glyph index in alpha
 *   Pass C  cellRT  -> canvas    (full res)              1 cell sample + 1 atlas
 *                                                        sample per fragment
 *
 * Pass A rendering at ~576x324 instead of 1920x1080 is a ~11x fragment saving,
 * and it costs nothing visually because the ASCII grid throws that detail away.
 */

/**
 * Density ramp, darkest -> brightest. Index 0..9.
 * Tops out in block glyphs rather than @ — at ~10px cells the punctuation end
 * of a classic ramp reads as noise, and a lit surface needs cells that are
 * mostly ink to register as a solid body.
 */
const RAMP = ' .:=+*#%▓█'
/** Directional glyphs for detected edges. Index 10..13. */
const EDGE_GLYPHS = ['-', '/', '|', '\\']

const ATLAS_COLS = 4
const ATLAS_ROWS = 4
const ATLAS_CELL_PX = 64

/**
 * Rasterises the glyph set into a 4x4 texture atlas at runtime. Avoids shipping
 * a font file — the browser's built-in monospace is available immediately, and
 * at this size the exact typeface is barely legible anyway.
 */
function createGlyphAtlas(): THREE.CanvasTexture {
  const glyphs = [...RAMP, ...EDGE_GLYPHS]
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_COLS * ATLAS_CELL_PX
  canvas.height = ATLAS_ROWS * ATLAS_CELL_PX

  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fff'
  ctx.font = `bold ${Math.round(ATLAS_CELL_PX * 0.95)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  glyphs.forEach((glyph, i) => {
    const x0 = (i % ATLAS_COLS) * ATLAS_CELL_PX
    const y0 = Math.floor(i / ATLAS_COLS) * ATLAS_CELL_PX
    const cx = x0 + ATLAS_CELL_PX / 2
    const cy = y0 + ATLAS_CELL_PX / 2

    // The top two ramp steps are painted as rects, not text. fillText leaves
    // dark gutters even for U+2588 FULL BLOCK — monospace glyphs only ink ~60%
    // of the cell's width. A hairline inset stays, though: with edge-to-edge
    // rects, adjacent max-luma cells merge into one featureless shape, and a
    // saturated region (the ball) reads as a flat disc instead of ASCII.
    const inset = ATLAS_CELL_PX * 0.07
    if (glyph === '█') {
      ctx.fillRect(x0 + inset, y0 + inset, ATLAS_CELL_PX - inset * 2, ATLAS_CELL_PX - inset * 2)
      return
    }
    if (glyph === '▓') {
      ctx.globalAlpha = 0.62
      ctx.fillRect(x0 + inset, y0 + inset, ATLAS_CELL_PX - inset * 2, ATLAS_CELL_PX - inset * 2)
      ctx.globalAlpha = 1
      return
    }

    // Stretch text glyphs horizontally to close the monospace advance gap.
    // Uniform rather than per-glyph so '.' and '#' keep their relative weights.
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(1.55, 1)
    ctx.fillText(glyph, 0, 0)
    ctx.restore()
  })

  const texture = new THREE.CanvasTexture(canvas)
  // Canvas y runs downward; the shader compensates with (1.0 - inCell.y).
  texture.flipY = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return texture
}

const QUAD_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/**
 * Pass B — one fragment per character cell. Averages the supersampled block,
 * runs a Sobel at cell resolution, and writes the chosen glyph index into alpha.
 */
const CELL_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform vec2 uCells;
  uniform float uEdgeThreshold;
  uniform float uLumaFloor;
  uniform float uRampGamma;

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  vec3 cellAverage(vec2 cellIdx) {
    vec3 sum = vec3(0.0);
    for (int y = 0; y < SUPERSAMPLE; y++) {
      for (int x = 0; x < SUPERSAMPLE; x++) {
        vec2 sub = (vec2(float(x), float(y)) + 0.5) / float(SUPERSAMPLE);
        sum += texture2D(tScene, (cellIdx + sub) / uCells).rgb;
      }
    }
    return sum / float(SUPERSAMPLE * SUPERSAMPLE);
  }

  float neighbourLuma(vec2 cellIdx) {
    return luma(texture2D(tScene, (cellIdx + 0.5) / uCells).rgb);
  }

  void main() {
    vec2 cellIdx = floor(vUv * uCells);
    vec3 color = cellAverage(cellIdx);
    float l = luma(color);

    float tl = neighbourLuma(cellIdx + vec2(-1.0,  1.0));
    float tc = neighbourLuma(cellIdx + vec2( 0.0,  1.0));
    float tr = neighbourLuma(cellIdx + vec2( 1.0,  1.0));
    float ml = neighbourLuma(cellIdx + vec2(-1.0,  0.0));
    float mr = neighbourLuma(cellIdx + vec2( 1.0,  0.0));
    float bl = neighbourLuma(cellIdx + vec2(-1.0, -1.0));
    float bc = neighbourLuma(cellIdx + vec2( 0.0, -1.0));
    float br = neighbourLuma(cellIdx + vec2( 1.0, -1.0));

    float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
    float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
    float magnitude = length(vec2(gx, gy));

    // An isolated bright cell (a star) is a spike, not a surface boundary.
    // Without this test every star gets ringed by directional glyphs and the
    // whole field turns to static.
    float neighbourAverage = (tl + tc + tr + ml + mr + bl + bc + br) / 8.0;
    bool isSpike = l > neighbourAverage * 2.0 + 0.02;

    // Edge glyphs are for silhouettes against space, which are boundary cells
    // of middling luma. A genuinely lit cell keeps its density glyph even on a
    // strong gradient — without this gate every facet boundary inside a planet
    // hatched, and bodies rendered as sparse slashes instead of filled surfaces.
    bool litSurface = l > 0.42;

    float index;
    if (l < uLumaFloor) {
      index = 0.0;
    } else if (magnitude > uEdgeThreshold && !isSpike && !litSurface) {
      // The edge runs perpendicular to the luminance gradient. Fold to 0..PI
      // and quantise into four buckets: - / | \\
      // NB: do not name this "tangent" — three's shader prelude already claims it.
      float edgeAngle = atan(gy, gx) + 1.5707963;
      edgeAngle = mod(edgeAngle + 3.14159265, 3.14159265);
      float sector = mod(floor(edgeAngle / 3.14159265 * 4.0 + 0.5), 4.0);
      index = 10.0 + sector;
    } else {
      index = floor(pow(clamp(l, 0.0, 1.0), uRampGamma) * 9.0 + 0.5);
    }

    // Pack the index into alpha. (i + 0.5) / 16 keeps every slot comfortably
    // inside its own 8-bit bucket after quantisation.
    gl_FragColor = vec4(color, (index + 0.5) / 16.0);
  }
`

/**
 * Pass C — full resolution. Two texture reads per fragment: which glyph this
 * cell wants, and what that glyph looks like at this sub-position.
 */
const COMPOSITE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D tCells;
  uniform sampler2D tAtlas;
  uniform vec2 uCells;
  uniform vec3 uBackground;
  uniform vec3 uInkDark;
  uniform vec3 uInkLight;
  uniform float uTime;

  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  float fbm(vec2 p) {
    float amp = 0.5;
    float sum = 0.0;
    for (int i = 0; i < 4; i++) {
      sum += vnoise(p) * amp;
      p *= 2.03;
      amp *= 0.5;
    }
    return sum;
  }

  // Ordered-dither matrix, the classic recursive construction. Evaluated on
  // cell indices so the dither pattern is locked to the character grid.
  float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

  // Posterize a mask into a fixed number of bands, the dither deciding which side
  // of each band boundary a cell falls on — banding plus dither is the 8-bit
  // look; banding alone is just a broken gradient.
  float quant(float v, float levels, float dither) {
    return clamp(floor(v * levels + dither) / levels, 0.0, 1.0);
  }

  /*
   * The grainy colour field behind the glyphs — deep-field photography rather
   * than flat void. Painted here in the composite pass instead of in the 3D
   * scene, so it never crosses the luma floor: the negative space stays free of
   * glyphs and carries colour as *background*, which is what gives the frame
   * depth without hazing it with '.'.
   *
   * Shaped by fbm rather than radial pools: smooth gradients read as stage
   * lighting, and it is the billowed, filamented edges that make it read as
   * nebula. Hues are deep — crimson, burnt orange, indigo, bottle teal — with
   * saturation carried at low luminance so the frame stays *space* dark.
   * All values linear; the encode below handles sRGB.
   */
  vec3 background(vec2 uv) {
    vec2 p = uv * vec2(uCells.x / uCells.y, 1.0);
    vec2 cell = floor(uv * uCells);
    // Centred, so quantization dithers both ways around each band boundary.
    // Scaled below full band width so the stipple concentrates in a fringe at
    // each boundary instead of checkerboarding entire regions.
    float d = (bayer4(cell) - 0.5) * 0.55;
    float driftA = fbm(p * 2.1 + vec2(uTime * 0.010, 0.0));
    float driftB = fbm(p * 3.2 + vec2(5.2, 1.3) - uTime * 0.008);

    // Every layer mask is posterized through the dither, so cloud edges band
    // and pixel-stipple instead of blending — sprite clouds, not photographs.
    // All four layers are muted blues: the backdrop's job is depth and texture,
    // and the planets are the only colourful things in frame.
    vec3 c = uBackground;
    // Deep navy sky, dense toward the top, broken by the cloud field.
    c += vec3(0.004, 0.009, 0.048) * quant(smoothstep(0.25, 1.0, uv.y) * (0.45 + 0.9 * driftA), 4.0, d);
    // Slate-blue dust bank along the bottom, billowed at its top edge.
    c += vec3(0.011, 0.015, 0.038) * quant(smoothstep(0.65, 0.0, uv.y) * smoothstep(0.30, 0.68, driftA), 3.0, d);
    // Dimmer indigo filaments threaded through the middle of frame.
    c += vec3(0.008, 0.009, 0.030) * quant(smoothstep(0.46, 0.82, driftB), 3.0, d);
    // Slightly cooler haze high in frame, where the navy thins.
    c += vec3(0.004, 0.012, 0.022) * quant(smoothstep(0.5, 0.88, fbm(p * 1.6 + 9.7)) * smoothstep(0.35, 0.95, uv.y), 3.0, d);
    // Vignette pulls the corners back toward void — banded like the rest.
    c *= 1.0 - 0.7 * quant(smoothstep(0.3, 0.95, distance(uv, vec2(0.5, 0.5))), 4.0, d);
    // Static per-cell grain — animated film grain reads as video noise, a
    // fixed speckle reads as pixel art. Kept subtle; the dither carries the
    // texture, the grain only roughens it.
    float g = hash21(cell + 7.3);
    return c * (0.86 + 0.28 * g);
  }

  void main() {
    vec2 cellIdx = floor(vUv * uCells);
    vec4 cell = texture2D(tCells, (cellIdx + 0.5) / uCells);
    float index = floor(cell.a * 16.0);

    vec2 inCell = fract(vUv * uCells);
    float col = mod(index, 4.0);
    float row = floor(index / 4.0);
    vec2 atlasUv = vec2(col + inCell.x, row + (1.0 - inCell.y)) / vec2(4.0, 4.0);
    float glyph = texture2D(tAtlas, atlasUv).r;

    float l = dot(cell.rgb, vec3(0.2126, 0.7152, 0.0722));
    // Posterize the shading into discrete bands, dithered on the same Bayer
    // grid as the backdrop — surfaces shade in steps like sprite art instead
    // of sweeping smoothly through the ramp.
    float d = bayer4(cellIdx) - 0.5;
    float lq = quant(l, 6.0, d);
    vec3 cellColor = clamp(floor(cell.rgb * 6.0 + 0.5 + d) / 6.0, 0.0, 1.0);
    // Blend a palette ramp with the scene's own colour. The scene share is
    // high — the bodies carry the deep-field hues now, and over-tinting them
    // blue would collapse the colour the scene was given. The steep ramp is
    // deliberate: dim cells hold a dark ink and lit cells snap to near-white,
    // so bodies pop instead of everything sitting in one grey.
    vec3 tint = mix(uInkDark, uInkLight, clamp(lq * 3.2, 0.0, 1.0));
    vec3 ink = mix(tint, cellColor * 2.1 + tint * 0.35, 0.72);

    vec3 color = mix(background(vUv), ink, glyph);

    // Everything above is linear; this is a custom ShaderMaterial so three does
    // not inject its own output transform. Encode manually.
    gl_FragColor = vec4(pow(max(color, 0.0), vec3(1.0 / 2.2)), 1.0);
  }
`

export class AsciiRenderer {
  private readonly renderer: THREE.WebGLRenderer
  private readonly sceneRT: THREE.WebGLRenderTarget
  private readonly cellRT: THREE.WebGLRenderTarget
  private readonly cellMaterial: THREE.ShaderMaterial
  private readonly compositeMaterial: THREE.ShaderMaterial
  private readonly quad: THREE.Mesh
  private readonly quadScene: THREE.Scene
  private readonly quadCamera: THREE.OrthographicCamera
  private readonly atlas: THREE.CanvasTexture

  /** Character grid dimensions, updated on resize. */
  cellsX = 1
  cellsY = 1

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.atlas = createGlyphAtlas()

    // Linear throughout — the composite pass does the sRGB encode itself.
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    })
    this.cellRT = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    })

    this.cellMaterial = new THREE.ShaderMaterial({
      defines: { SUPERSAMPLE: CONFIG.ascii.supersample },
      uniforms: {
        tScene: { value: this.sceneRT.texture },
        uCells: { value: new THREE.Vector2(1, 1) },
        uEdgeThreshold: { value: CONFIG.ascii.edgeThreshold },
        uLumaFloor: { value: CONFIG.ascii.lumaFloor },
        uRampGamma: { value: CONFIG.ascii.rampGamma },
      },
      vertexShader: QUAD_VERTEX_SHADER,
      fragmentShader: CELL_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    })

    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tCells: { value: this.cellRT.texture },
        tAtlas: { value: this.atlas },
        uCells: { value: new THREE.Vector2(1, 1) },
        uBackground: { value: new THREE.Color(PALETTE.void) },
        // `mid` rather than `slate` so the dim end genuinely recedes — with the
        // steeper tint ramp above, contrast comes from dark darks AND bright
        // lights, not from lifting everything to the same grey.
        uInkDark: { value: new THREE.Color(PALETTE.mid) },
        uInkLight: { value: new THREE.Color(PALETTE.white) },
        uTime: { value: 0 },
      },
      vertexShader: QUAD_VERTEX_SHADER,
      fragmentShader: COMPOSITE_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    })

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.cellMaterial)
    this.quad.frustumCulled = false
    this.quadScene = new THREE.Scene()
    this.quadScene.add(this.quad)
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  }

  /** @param width/@param height in CSS pixels. */
  setSize(width: number, height: number): void {
    const { cellSize, supersample } = CONFIG.ascii
    this.cellsX = Math.max(1, Math.floor(width / cellSize))
    this.cellsY = Math.max(1, Math.floor(height / cellSize))

    this.sceneRT.setSize(this.cellsX * supersample, this.cellsY * supersample)
    this.cellRT.setSize(this.cellsX, this.cellsY)

    const cells = this.cellMaterial.uniforms.uCells.value as THREE.Vector2
    cells.set(this.cellsX, this.cellsY)
    const compositeCells = this.compositeMaterial.uniforms.uCells.value as THREE.Vector2
    compositeCells.set(this.cellsX, this.cellsY)
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const { renderer } = this
    this.compositeMaterial.uniforms.uTime.value = performance.now() / 1000

    renderer.setRenderTarget(this.sceneRT)
    renderer.clear()
    renderer.render(scene, camera)

    this.quad.material = this.cellMaterial
    renderer.setRenderTarget(this.cellRT)
    renderer.clear()
    renderer.render(this.quadScene, this.quadCamera)

    this.quad.material = this.compositeMaterial
    renderer.setRenderTarget(null)
    renderer.clear()
    renderer.render(this.quadScene, this.quadCamera)
  }

  dispose(): void {
    this.sceneRT.dispose()
    this.cellRT.dispose()
    this.cellMaterial.dispose()
    this.compositeMaterial.dispose()
    this.atlas.dispose()
    this.quad.geometry.dispose()
  }
}
