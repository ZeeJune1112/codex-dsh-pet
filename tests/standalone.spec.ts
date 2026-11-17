import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopPetHost } from '../src/standalone'
import { HostStorage } from '../src/host/persistence'
import type { WindowBackend, WindowBackendOptions, WindowHandle } from '../src/renderer/backend/WindowBackend'
import type { PetFrame } from '../src/renderer/FrameDecoder'

class FakeHandle implements WindowHandle {
  shown = true
  destroyed = false
  constructor(readonly options: WindowBackendOptions) {}
  present(_frame: PetFrame): void {}
  move(): void {}
  setAlwaysOnTop(): void {}
  show(): void { this.shown = true }
  hide(): void { this.shown = false }
  destroy(): void { this.destroyed = true }
}

function fakeBackend() {
  const handles: FakeHandle[] = []
  const backend: WindowBackend = {
    name: 'fake',
    isSupported: () => true,
    async create(options) {
      const handle = new FakeHandle(options)
      handles.push(handle)
      return handle
    },
  }
  return { backend, handles }
}

const atlas = { width: 1536, height: 1872, rgba: new Uint8Array(1536 * 1872 * 4) }

describe('DesktopPetHost', () => {
  it('persists drag position and scale, wires hover and right-click hide, and cleans up', async () => {
    const storage = new HostStorage(mkdtempSync(join(tmpdir(), 'codex-dsh-pet-')))
    const { backend, handles } = fakeBackend()
    const host = new DesktopPetHost({ backend, storage, atlas })

    await host.start()
    expect(handles).toHaveLength(1)
    expect(handles[0].shown).toBe(true)

    handles[0].options.onDrag?.(120, 80)
    expect(storage.load()).toMatchObject({ position: { x: 120, y: 80 } })

    handles[0].options.onHover?.()
    expect(host.currentPose).toBe('jumping')
    handles[0].options.onUnhover?.()
    expect(host.currentPose).toBe('idle')

    handles[0].options.onClose?.()
    expect(handles[0].shown).toBe(false)

    await host.setScale(1.5)
    expect(storage.load().scale).toBe(1.5)
    expect(handles).toHaveLength(2)
    expect(handles[0].destroyed).toBe(true)

    await host.stop()
    expect(handles[1].destroyed).toBe(true)
    expect(existsSync(storage.lockPath)).toBe(false)
  })

  it('rejects a second host while the first owns the data directory', async () => {
    const storage = new HostStorage(mkdtempSync(join(tmpdir(), 'codex-dsh-pet-')))
    const first = new DesktopPetHost({ backend: fakeBackend().backend, storage, atlas })
    const second = new DesktopPetHost({ backend: fakeBackend().backend, storage, atlas })

    await first.start()
    await expect(second.start()).rejects.toThrow(/already running/)
    await first.stop()
    await second.start()
    await second.stop()
  })
})
