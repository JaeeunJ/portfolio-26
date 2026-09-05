import * as THREE from 'three'
import { CONFIG, PALETTE } from './config'

/*
 * Hairline motion streaks.
 *
 * They are laid out in POLAR coordinates around the focus of expansion — the
 * screen point the camera is flying toward — and always run radially. When you
 * move forward, everything in view streaks directly away from that point; an
 * angle chosen independently of screen position reads as a scratch on the lens
 * instead of motion through space.
 *
 * The focus is derived from the camera's actual travel direction rather than
 * assumed to be screen centre, so it drifts off-centre as the path curves and
 * the camera rolls.
 *
 * Positioned in the CAMERA's basis rather than world space: each streak sits at
 * a depth ahead of the camera and is offset within the view plane, so it is
 * always somewhere on screen by construction. Scattering them through world
 * space means most are behind you or outside the frustum at any moment.
 *
 * Width scales with depth so every streak lands at the same on-screen thickness;
 * a constant world width would make near ones fat bars and far ones vanish below
 * a character cell.
 */

const S = CONFIG.streaks

interface Streak {
  /** Polar angle around the focus of expansion. */
  angle: number
  /** Radial distance at birth, in vertical half-extents. */
  startRadius: number
  depth: number
  lengthScale: number
  /** Offset into the fire cycle, so they do not all flash at once. */
  phase: number
}

function mod1(value: number): number {
  return value - Math.floor(value)
}

function createStreak(): Streak {
  return {
    angle: Math.random() * Math.PI * 2,
    startRadius: S.radiusMin + Math.random() * (S.radiusMax - S.radiusMin),
    depth: S.depthMin + Math.random() * (S.depthMax - S.depthMin),
    lengthScale: 0.75 + Math.random() * 0.55,
    phase: Math.random(),
  }
}

export interface Streaks {
  /**
   * @param progress 0..1 along the flight.
   * @param seconds elapsed wall-clock.
   * @param travelDirection world-space unit vector the camera is moving along.
   * @param activity 0..1 scroll-speed gate — streaks are motion, so they only
   *   show while the reader is actually moving, scaling with how fast.
   */
  update(
    progress: number,
    seconds: number,
    camera: THREE.PerspectiveCamera,
    travelDirection: THREE.Vector3,
    activity: number,
  ): void
  dispose(): void
}

export function createStreaks(scene: THREE.Scene): Streaks {
  const streaks = Array.from({ length: S.count }, createStreak)

  const perStreak = (S.segments + 1) * 2
  const vertexCount = S.count * perStreak
  const positions = new Float32Array(vertexCount * 3)
  const colors = new Float32Array(vertexCount * 3)

  const indices: number[] = []
  for (let i = 0; i < S.count; i++) {
    const base = i * perStreak
    for (let j = 0; j < S.segments; j++) {
      const a = base + j * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(indices)

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      // Depth-tested but not depth-writing, so a streak can pass behind a planet
      // without punching a hole in anything drawn after it.
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  mesh.frustumCulled = false
  scene.add(mesh)

  const right = new THREE.Vector3()
  const up = new THREE.Vector3()
  const forward = new THREE.Vector3()
  const viewTravel = new THREE.Vector3()
  const center = new THREE.Vector3()
  const axis = new THREE.Vector3()
  const perpendicular = new THREE.Vector3()
  const point = new THREE.Vector3()
  const tint = new THREE.Color(PALETTE.white)

  function update(
    progress: number,
    seconds: number,
    camera: THREE.PerspectiveCamera,
    travelDirection: THREE.Vector3,
    activity: number,
  ): void {
    right.setFromMatrixColumn(camera.matrixWorld, 0)
    up.setFromMatrixColumn(camera.matrixWorld, 1)
    forward.setFromMatrixColumn(camera.matrixWorld, 2).negate()

    // Focus of expansion, expressed as a view-plane offset per unit of depth.
    // View space looks down -z, so the forward component is -z.
    viewTravel.copy(travelDirection).transformDirection(camera.matrixWorldInverse)
    const forwardComponent = -viewTravel.z
    const focusPerDepthX = forwardComponent > 1e-4 ? viewTravel.x / forwardComponent : 0
    const focusPerDepthY = forwardComponent > 1e-4 ? viewTravel.y / forwardComponent : 0

    const halfFovTan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)

    for (let i = 0; i < S.count; i++) {
      const streak = streaks[i]
      const base = i * perStreak

      const cycle = mod1(progress * S.progressCycles + seconds * S.timeCycles + streak.phase)
      const alive = cycle < S.dutyCycle
      const local = alive ? cycle / S.dutyCycle : 0
      // Envelope over the streak's lifetime: fades in, peaks, fades out.
      // Scaled by scroll activity — the time term keeps the cycle advancing
      // while idle so no streak freezes mid-frame, but at rest they carry no
      // brightness at all.
      const life = alive ? Math.sin(Math.PI * local) * activity : 0

      const { depth } = streak
      const extentY = depth * halfFovTan
      const extentX = extentY * camera.aspect

      // Travels outward from the focus over its life, the way real optic flow does.
      const radius = streak.startRadius + local * S.sweep
      const offsetX = Math.cos(streak.angle) * radius * extentX
      const offsetY = Math.sin(streak.angle) * radius * extentY

      // Radial direction, in view-plane world units rather than normalised
      // screen units — otherwise the aspect ratio skews the angle.
      const radialLength = Math.hypot(offsetX, offsetY) || 1e-4
      const dirX = offsetX / radialLength
      const dirY = offsetY / radialLength

      const length = Math.max(
        radialLength * S.lengthFactor * streak.lengthScale,
        depth * S.minLengthPerDepth,
      )
      const halfWidth = depth * S.halfWidthPerDepth

      center
        .copy(camera.position)
        .addScaledVector(forward, depth)
        .addScaledVector(right, focusPerDepthX * depth + offsetX)
        .addScaledVector(up, focusPerDepthY * depth + offsetY)

      axis.set(0, 0, 0).addScaledVector(right, dirX).addScaledVector(up, dirY)
      perpendicular.set(0, 0, 0).addScaledVector(right, -dirY).addScaledVector(up, dirX)

      for (let j = 0; j <= S.segments; j++) {
        const along = (j / S.segments - 0.5) * length
        point.copy(center).addScaledVector(axis, along)

        // Soft taper at both ends so the streak dissolves rather than stopping
        // on a hard edge. Exponent < 1 keeps the middle stretch near full
        // brightness instead of peaking at a single point.
        const profile = Math.pow(Math.sin((Math.PI * j) / S.segments), 0.55)
        const brightness = life * profile * S.opacity

        const v = base + j * 2
        for (const [slot, sign] of [[v, 1], [v + 1, -1]] as const) {
          const p = slot * 3
          positions[p + 0] = point.x + perpendicular.x * halfWidth * sign
          positions[p + 1] = point.y + perpendicular.y * halfWidth * sign
          positions[p + 2] = point.z + perpendicular.z * halfWidth * sign
          // Additive blending: black is invisible, so brightness IS the alpha.
          colors[p + 0] = tint.r * brightness
          colors[p + 1] = tint.g * brightness
          colors[p + 2] = tint.b * brightness
        }
      }
    }

    geometry.attributes.position.needsUpdate = true
    geometry.attributes.color.needsUpdate = true
  }

  function dispose(): void {
    geometry.dispose()
    mesh.material.dispose()
  }

  return { update, dispose }
}
