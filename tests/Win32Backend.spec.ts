import { afterEach, describe, expect, it, vi } from 'vitest'
import { Win32Backend, recoverWindowPosition } from '../src/renderer/backend/Win32Backend'
import type { WindowHandle } from '../src/renderer/backend/WindowBackend'

const native = vi.hoisted(() => ({
  proc: undefined as ((hwnd: bigint, message: number, wParam: number, lParam: number) => number) | undefined,
  nextHwnd: 0n,
  cursor: { x: 40, y: 40 },
  windows: new Map<bigint, { left: number; top: number; right: number; bottom: number }>(),
  styles: new Map<bigint, number>(),
  moves: [] as unknown[][],
  workArea: { left: 0, top: 0, right: 1920, bottom: 1080 },
}))

vi.mock('koffi', () => ({ default: {
  struct: (name: string) => name,
  pointer: (value: unknown) => value,
  proto: (value: unknown) => value,
  register: (fn: typeof native.proc) => { native.proc = fn; return 1n },
  alloc: () => ({ value: undefined }),
  encode: (slot: { value: unknown }, _type: unknown, value: unknown) => { slot.value = value },
  decode: (slot: { value: unknown }) => slot.value,
  sizeof: () => 40,
  view: (value: ArrayBuffer) => value,
  load: () => ({ func: (_calling: string, name: string) => (...args: any[]) => {
    if (name === 'CreateWindowExW') {
      const hwnd = ++native.nextHwnd
      native.styles.set(hwnd, args[0])
      native.windows.set(hwnd, { left: args[4], top: args[5], right: args[4] + args[6], bottom: args[5] + args[7] })
      return hwnd
    }
    if (name === 'CreateDIBSection') {
      const header = args[1].value
      args[3].value = new ArrayBuffer(header.biWidth * -header.biHeight * 4)
      return 1n
    }
    if (name === 'GetCursorPos') args[0].value = { ...native.cursor }
    if (name === 'GetWindowRect') args[1].value = { ...native.windows.get(args[0]) }
    if (name === 'GetMonitorInfoW') args[1].value = { rcWork: native.workArea }
    if (name === 'SetWindowPos') {
      native.moves.push(args)
      if (!(args[6] & 2)) Object.assign(native.windows.get(args[0])!, { left: args[2], top: args[3] })
    }
    if (name === 'PeekMessageW') return 0
    return 1
  } }),
} }))

const handles: WindowHandle[] = []
afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy()
  native.workArea = { left: 0, top: 0, right: 1920, bottom: 1080 }
})

const callbacks = () => ({ onDrag: vi.fn(), onDragMove: vi.fn(), onDragEnd: vi.fn(), onHover: vi.fn(), onUnhover: vi.fn(), onClose: vi.fn() })
const options = { x: 40, y: 40, width: 192, height: 208, alwaysOnTop: false }

describe('Win32 window seams', () => {
  it('routes drag, hover and close to their HWND and removes destroyed callbacks', async () => {
    const backend = new Win32Backend()
    const first = callbacks()
    const second = callbacks()
    handles.push(await backend.create({ ...options, ...first }))
    const firstHwnd = native.nextHwnd
    handles.push(await backend.create({ ...options, ...second }))
    const secondHwnd = native.nextHwnd
    const emit = (hwnd: bigint, message: number) => native.proc!(hwnd, message, 0, 0)
    emit(firstHwnd, 0x00a0) // WM_NCMOUSEMOVE
    emit(firstHwnd, 0x02a2) // WM_NCMOUSELEAVE
    emit(firstHwnd, 0x00a5) // WM_NCRBUTTONUP
    native.cursor = { x: 40, y: 40 }
    emit(firstHwnd, 0x00a1) // WM_NCLBUTTONDOWN
    native.cursor = { x: 55, y: 60 }
    emit(secondHwnd, 0x0200) // Another instance must not inherit the drag.
    emit(firstHwnd, 0x0200)
    emit(firstHwnd, 0x0202) // WM_LBUTTONUP
    expect(first.onHover).toHaveBeenCalledOnce()
    expect(first.onUnhover).toHaveBeenCalledOnce()
    expect(first.onClose).toHaveBeenCalledOnce()
    expect(first.onDragMove).toHaveBeenCalledWith('right')
    expect(first.onDragEnd).toHaveBeenCalledOnce()
    expect(first.onDrag).toHaveBeenCalledWith(55, 60)
    for (const callback of Object.values(second)) expect(callback).not.toHaveBeenCalled()
    expect(native.styles.get(firstHwnd)! & 8).toBe(0)
    expect(native.moves.at(-1)?.[1]).toBe(-2)
    handles[0].setAlwaysOnTop(true)
    handles[0].move(80, 90)
    expect(native.moves.at(-1)?.[1]).toBe(-1)
    handles[0].destroy()
    emit(firstHwnd, 0x00a0)
    expect(first.onHover).toHaveBeenCalledOnce()
    emit(secondHwnd, 0x00a0)
    expect(second.onHover).toHaveBeenCalledOnce()
  })

  it('recovers persisted position into the nearest monitor work area', async () => {
    const onDrag = vi.fn()
    handles.push(await new Win32Backend().create({ ...options, x: 4000, y: -2000, onDrag }))
    expect(native.windows.get(native.nextHwnd)).toMatchObject({ left: 1728, top: 0 })
    expect(onDrag).toHaveBeenCalledWith(1728, 0)
  })

  it('recovers a running pet after the display work area changes', async () => {
    const onDrag = vi.fn()
    handles.push(await new Win32Backend().create({ ...options, x: 1600, y: 500, onDrag }))
    const hwnd = native.nextHwnd
    native.workArea = { left: 0, top: 0, right: 1280, bottom: 720 }
    native.proc!(hwnd, 0x007e, 0, 0) // WM_DISPLAYCHANGE
    expect(native.windows.get(hwnd)).toMatchObject({ left: 1088, top: 500 })
    expect(onDrag).toHaveBeenCalledWith(1088, 500)
  })

  it('moves a fully offscreen window back into the virtual desktop', () => {
    expect(recoverWindowPosition({ x: 4000, y: -2000 }, { width: 192, height: 208 }, { left: 0, top: 0, right: 1920, bottom: 1080 }))
      .toEqual({ x: 1728, y: 0 })
    expect(recoverWindowPosition({ x: -1800, y: 40 }, { width: 192, height: 208 }, { left: -1920, top: 0, right: 0, bottom: 1080 }))
      .toEqual({ x: -1800, y: 40 })
  })
})
