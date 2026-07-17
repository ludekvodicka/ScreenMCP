import { describe, expect, it } from 'vitest'
import { accessMode } from '../shared/access-mode'
import { createDemoApi } from './demo-api'

describe('demo access modes', () => {
  it('supports Off, Read-only, and source-bound Interactive', async () => {
    const api = createDemoApi()
    let state = await api.getBootstrapState()
    expect(state.settings.accessModeDefault).toBe('read-only')
    expect(state.settings.followActiveDialogs).toBe(true)
    expect(accessMode({ stopped: state.stopped, armed: state.controlState.armed })).toBe('read-only')

    await api.setAccessMode('off')
    state = await api.getBootstrapState()
    expect(accessMode({ stopped: state.stopped, armed: state.controlState.armed })).toBe('off')
    await expect(api.getPreview()).rejects.toThrow('access mode is Off')

    await expect(api.setAccessMode('interactive')).rejects.toThrow('Select a source')
    state = await api.getBootstrapState()
    expect(accessMode({ stopped: state.stopped, armed: state.controlState.armed })).toBe('off')

    await api.pickSource('window')
    await api.setAccessMode('interactive')
    state = await api.getBootstrapState()
    expect(accessMode({ stopped: state.stopped, armed: state.controlState.armed })).toBe('interactive')

    await api.setAccessMode('read-only')
    state = await api.getBootstrapState()
    expect(accessMode({ stopped: state.stopped, armed: state.controlState.armed })).toBe('read-only')
  })

  it('previews and resolves an Interactive write request', async () => {
    const api = createDemoApi({ interactiveRequest: 'click' })
    const updates: number[] = []
    const unsubscribe = api.onInteractiveRequests(requests => updates.push(requests.length))

    let state = await api.getBootstrapState()
    expect(state.selection?.kind).toBe('window')
    expect(state.interactiveRequests).toEqual([expect.objectContaining({ action: 'click', client: 'codex' })])

    await api.respondInteractiveRequest(state.interactiveRequests[0]!.id, 'enable-interactive')
    state = await api.getBootstrapState()
    expect(accessMode({ stopped: state.stopped, armed: state.controlState.armed })).toBe('interactive')
    expect(state.interactiveRequests).toEqual([])
    expect(updates).toEqual([0])

    unsubscribe()
  })
})
