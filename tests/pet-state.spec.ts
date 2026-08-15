import { describe, expect, it } from 'vitest'
import { normalizeState, quantizeScale } from '../src/pet-state'

describe('pet state', () => {
  it('keeps each pet independent and appends newly discovered pets', () => {
    const state = normalizeState({
      version: 1,
      selectedPetId: 'b',
      order: ['b', 'a'],
      pets: {
        a: { visible: false, scale: 1, hideWhenIdle: false, position: { x: 2, y: 3 } },
        b: { visible: true, scale: 2, hideWhenIdle: true, position: { x: 8, y: 9 } },
      },
    }, ['a', 'b', 'c'], 'a')
    expect(state.order).toEqual(['b', 'a', 'c'])
    expect(state.selectedPetId).toBe('b')
    expect(state.pets.a.visible).toBe(false)
    expect(state.pets.b).toMatchObject({ visible: true, scale: 2, hideWhenIdle: true, position: { x: 8, y: 9 } })
    expect(state.pets.c.visible).toBe(false)
  })

  it('preserves an all-hidden library across reloads', () => {
    const state = normalizeState({ order: ['a'], selectedPetId: 'a', pets: { a: { visible: false } } }, ['a'], 'a')
    expect(state.pets.a.visible).toBe(false)
  })

  it('quantizes and clamps scale values', () => {
    expect(quantizeScale(1.13)).toBe(1.25)
    expect(quantizeScale(99)).toBe(4)
    expect(quantizeScale(-1)).toBe(0.5)
  })
})
