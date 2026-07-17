import { describe, expect, it, vi } from 'vitest'
import type { SourceSelection } from '../shared/contracts'
import { WindowDialogFollower, type WindowDialogEnvironment } from './window-dialog-follower'

describe('WindowDialogFollower', () => {
  it('matches a Windows modal to its external Electron capture source', async () => {
    const environment = fakeEnvironment()
    environment.activeModal.mockReturnValue({ id: -2_147_483_647, title: 'Native title', owner: { processId: 10 }, bounds: { x: 900, y: 700, width: 600, height: 400 } })
    environment.captureWindows.mockResolvedValue([
      { id: 'window:2147483649:1', name: 'Own source' },
      { id: 'window:2147483649:0', name: 'Confirm replace' },
    ])

    await expect(new WindowDialogFollower(environment).resolve(root())).resolves.toEqual({ kind: 'dialog', capture: { kind: 'listed', id: 'window:2147483649:0' }, label: 'Confirm replace' })
    expect(environment.activeModal).toHaveBeenCalledWith(101)
  })

  it('derives a trusted direct target when Electron omits a native modal', async () => {
    const environment = fakeEnvironment()
    const follower = new WindowDialogFollower(environment)
    await expect(follower.resolve(root())).resolves.toEqual({ kind: 'root' })
    expect(environment.captureWindows).not.toHaveBeenCalled()

    environment.activeModal.mockReturnValue({ id: -2_147_483_647, title: ' Copy files ', owner: { processId: 10 }, bounds: { x: 0, y: 0, width: 100, height: 100 } })
    await expect(follower.resolve(root())).resolves.toEqual({ kind: 'dialog', capture: { kind: 'unlisted', id: 'window:2147483649:0' }, label: 'Copy files' })
  })

  it('is inert for non-Windows and non-window sources', async () => {
    const environment = fakeEnvironment('linux')
    const follower = new WindowDialogFollower(environment)
    await expect(follower.resolve(root())).resolves.toEqual({ kind: 'root' })
    await expect(follower.resolve({ captureId: 'screen:1:0', kind: 'monitor', label: 'Display', width: 100, height: 100 })).resolves.toEqual({ kind: 'root' })
    expect(environment.activeModal).not.toHaveBeenCalled()
  })
})

function root(): SourceSelection {
  return { captureId: 'window:101:0', kind: 'window', label: 'Total Commander', width: 1_200, height: 800, captureWidth: 1_200, captureHeight: 800 }
}

function fakeEnvironment(platform: NodeJS.Platform = 'win32') {
  return {
    platform,
    activeModal: vi.fn<WindowDialogEnvironment['activeModal']>(() => null),
    captureWindows: vi.fn<WindowDialogEnvironment['captureWindows']>(() => Promise.resolve([])),
  }
}
