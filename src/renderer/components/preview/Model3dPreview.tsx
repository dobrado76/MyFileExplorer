import { useEffect, useRef, useState, type JSX } from 'react'
import { resolveModel3dMediaUrl } from '../../lib/model3dUrl'

type Props = {
  url: string
  filePath: string
  ext: string
}

export function Model3dPreview({ url, filePath, ext }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let raf = 0
    let renderer: import('three').WebGLRenderer | null = null
    let controls: { dispose(): void; update(): void } | null = null
    const disposables: { dispose(): void }[] = []

    const run = async (): Promise<void> => {
      const THREE = await import('three')
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js')
      if (cancelled) return

      const width = Math.max(40, host.clientWidth)
      const height = Math.max(160, host.clientHeight || 220)
      const scene = new THREE.Scene()
      const bg = getComputedStyle(host).getPropertyValue('--bg').trim() || '#16181e'
      scene.background = new THREE.Color(bg)

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 5000)
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(width, height, false)
      host.replaceChildren(renderer.domElement)

      scene.add(new THREE.HemisphereLight(0xc8d0dc, 0x2a2e38, 1.1))
      const key = new THREE.DirectionalLight(0xffffff, 0.85)
      key.position.set(2.2, 3.4, 1.6)
      scene.add(key)

      const manager = new THREE.LoadingManager()
      manager.setURLModifier((ref) => resolveModel3dMediaUrl(filePath, ref) ?? ref)

      let root: import('three').Object3D
      const kind = ext.toLowerCase()
      if (kind === 'obj') {
        const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js')
        const { MTLLoader } = await import('three/addons/loaders/MTLLoader.js')
        const objLoader = new OBJLoader(manager)
        try {
          const text = await (await fetch(url)).text()
          const m = /^\s*mtllib\s+(.+)$/im.exec(text)
          if (m?.[1]) {
            const mtlUrl = resolveModel3dMediaUrl(filePath, m[1].trim())
            if (mtlUrl) {
              const mtl = await new MTLLoader(manager).loadAsync(mtlUrl)
              mtl.preload()
              objLoader.setMaterials(mtl)
            }
          }
        } catch {
          /* untextured OBJ is fine */
        }
        root = await objLoader.loadAsync(url)
      } else if (kind === 'fbx') {
        const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js')
        root = await new FBXLoader(manager).loadAsync(url)
      } else if (kind === '3ds') {
        const { TDSLoader } = await import('three/addons/loaders/TDSLoader.js')
        root = await new TDSLoader(manager).loadAsync(url)
      } else {
        throw new Error('Unsupported 3D type')
      }
      if (cancelled) return

      root.traverse((obj) => {
        const mesh = obj as import('three').Mesh
        if (!mesh.isMesh) return
        const geom = mesh.geometry
        if (geom && !geom.getAttribute('normal')) geom.computeVertexNormals()
        if (!mesh.material) {
          mesh.material = new THREE.MeshStandardMaterial({
            color: 0x9aa3b2,
            roughness: 0.55,
            metalness: 0.08
          })
        }
        if (geom) disposables.push(geom)
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const mat of mats) {
          if (mat) disposables.push(mat)
        }
      })

      const box = new THREE.Box3().setFromObject(root)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      root.position.sub(center)
      scene.add(root)

      const maxDim = Math.max(size.x, size.y, size.z, 0.001)
      camera.near = maxDim / 200
      camera.far = maxDim * 40
      camera.position.set(maxDim * 1.15, maxDim * 0.75, maxDim * 1.35)
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()

      const orbit = new OrbitControls(camera, renderer.domElement)
      orbit.enableDamping = true
      orbit.target.set(0, 0, 0)
      orbit.update()
      controls = orbit

      const onResize = (): void => {
        if (!renderer || cancelled) return
        const w = Math.max(40, host.clientWidth)
        const h = Math.max(160, host.clientHeight || 220)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h, false)
      }
      const ro = new ResizeObserver(onResize)
      ro.observe(host)
      disposables.push({ dispose: () => ro.disconnect() })

      const tick = (): void => {
        raf = requestAnimationFrame(tick)
        orbit.update()
        renderer?.render(scene, camera)
      }
      tick()
      setStatus('ready')
    }

    void run().catch((e: unknown) => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      controls?.dispose()
      for (const d of disposables) {
        try {
          d.dispose()
        } catch {
          /* ignore */
        }
      }
      renderer?.dispose()
      renderer?.domElement.remove()
    }
  }, [url, filePath, ext])

  return (
    <div className="preview-model3d">
      {status === 'loading' ? <div className="preview-model3d-status">Loading 3D preview…</div> : null}
      {status === 'error' ? (
        <div className="preview-model3d-status">
          Could not load 3D preview{error ? `: ${error}` : ''}. Use Open with default app.
        </div>
      ) : null}
      <div ref={hostRef} className="preview-model3d-canvas" aria-label="3D model preview" />
    </div>
  )
}
