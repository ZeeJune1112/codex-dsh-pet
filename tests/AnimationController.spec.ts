import { describe, expect, it } from 'vitest'
import { AnimationController } from '../src/renderer/AnimationController'
import { createFakeClock } from './helpers/fakeClock'

const atlas = { width: 1536, height: 1872, rgba: new Uint8Array(1536 * 1872 * 4) }

describe('AnimationController', () => {
  it('scales frame durations by animation speed', () => {
    const fake = createFakeClock()
    const frames: unknown[] = []
    const controller = new AnimationController({ atlas, scale: 1, speed: 2, clock: fake.clock, onFrame: frame => frames.push(frame) })
    controller.start()
    expect(frames).toHaveLength(1)
    fake.advance(139)
    expect(frames).toHaveLength(1)
    fake.advance(1)
    expect(frames).toHaveLength(2)
    controller.dispose()
  })

  it('emits the first frame while stopped for static rendering', () => {
    const frames: unknown[] = []
    const controller = new AnimationController({ atlas, scale: 1, onFrame: frame => frames.push(frame) })
    controller.setState('running')
    expect(frames).toHaveLength(1)
    controller.dispose()
  })
})
