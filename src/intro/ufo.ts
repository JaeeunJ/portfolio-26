import * as THREE from 'three'

export function createUfoCat(radius = 1.0): THREE.Group {
  const ufoGroup = new THREE.Group()

  // 1. Saucer Base
  const baseGeo = new THREE.CylinderGeometry(radius * 1.3, radius * 0.8, radius * 0.18, 32)
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0xB4E500,
    emissive: 0x5a7500,
    emissiveIntensity: 0.9,
    roughness: 1.1,
    metalness: 0.05,
  })
  const base = new THREE.Mesh(baseGeo, baseMat)
  base.position.y = -radius * 0.05
  ufoGroup.add(base)

  // --- COCKPIT DOME FIXES ---

  // 2a. Cockpit Base Rim (Metallic collar that clearly defines where the dome starts)
  const collarGeo = new THREE.TorusGeometry(radius * 0.76, radius * 0.035, 8, 32)
  collarGeo.rotateX(Math.PI / 2)
  const collarMat = new THREE.MeshStandardMaterial({
    color: 0x101C1F,
    emissive: 0x101C1F,
    emissiveIntensity: 0.6,
    roughness: 1,
    metalness: 0.1,
  })
  const collar = new THREE.Mesh(collarGeo, collarMat)
  collar.position.y = 0.03
  ufoGroup.add(collar)

  // 2b. The Glass Dome (Faceted + Emissive Rim for ASCII pickup)
  // Fewer segments (20x10) gives the dome slight faceting, which ASCII renders much better than ultra-smooth spheres.
  const domeGeo = new THREE.SphereGeometry(
    radius * 0.75,
    26,
    10,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.5
  )

  // Replace transmission with flatShading + emissive highlights.
  // This produces sharp specular edges that the ASCII edge-detection/luminance pass catches.
  const domeMat = new THREE.MeshStandardMaterial({
    color: 0x4FA4B9,
    emissive: 0x4FA4B9,
    emissiveIntensity: 0.8, // Guarantees it stays above the ASCII luminance floor
    roughness: 0.15,
    metalness: 0.2,
    transparent: true,
    opacity: 0.55,           // Cat stays visible through the dome
    flatShading: true,       // Critical: gives ASCII character contrast across facets
    side: THREE.DoubleSide,
  })
  const dome = new THREE.Mesh(domeGeo, domeMat)
  dome.position.y = 0.03
  ufoGroup.add(dome)

  

  return ufoGroup
}