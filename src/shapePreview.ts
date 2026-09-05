/*
 * Dev-only preview of the three shaped bodies, rendered through the real ASCII
 * pipeline at the size they occupy in flight. Served at /shapes.html.
 *
 * Silhouette legibility at ~10px cells is impossible to judge while a body is
 * sweeping past at an arbitrary angle, so this isolates it: three bodies,
 * head-on, same renderer, same lighting.
 */
import './styles.css'
import * as THREE from 'three'
import { PALETTE } from './intro/config'
import { AsciiRenderer } from './intro/asciiRenderer'
import {
  buildBookBody,
  buildCatBody,
  buildCursorBody,
  buildHardHatBody,
  buildHeartBody,
} from './intro/spaceScene'

const scene = new THREE.Scene()
scene.background = new THREE.Color(PALETTE.void)

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000)
camera.position.set(0, 0, 150)
camera.lookAt(0, 0, 0)

const material = () =>
  new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.pale),
    flatShading: true,
    roughness: 0.95,
    side: THREE.DoubleSide,
  })

const RADIUS = 20
// `cat` is no longer placed in the flight, but is kept here so the builder stays
// live and reviewable rather than becoming dead code.
const bodies = [
  buildBookBody(RADIUS, material()),
  buildHeartBody(RADIUS, material()),
  buildCursorBody(RADIUS, material()),
  buildHardHatBody(RADIUS, material()),
  buildCatBody(RADIUS, material()),
]
bodies.forEach((body, i) => {
  body.position.x = (i - (bodies.length - 1) / 2) * 62
  scene.add(body)
})

scene.add(new THREE.AmbientLight(new THREE.Color(PALETTE.mid), 1.2))
const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.white), 4.5)
key.position.set(-1, 0.8, 0.6)
scene.add(key)
const rim = new THREE.DirectionalLight(new THREE.Color(PALETTE.accent), 2.0)
scene.add(rim.position.set(1, -0.5, 0.4) && rim)

const renderer = new THREE.WebGLRenderer({ antialias: false })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.toneMapping = THREE.ACESFilmicToneMapping
document.body.appendChild(renderer.domElement)

const ascii = new AsciiRenderer(renderer)

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight)
  ascii.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}
resize()
window.addEventListener('resize', resize)

/** ?spin=1 slowly turns each body so you can check the read from every angle. */
const spin = new URLSearchParams(location.search).has('spin')

function frame(now: number): void {
  requestAnimationFrame(frame)
  if (spin) bodies.forEach((b) => (b.rotation.y = now * 0.0004))
  ascii.render(scene, camera)
}
requestAnimationFrame(frame)
