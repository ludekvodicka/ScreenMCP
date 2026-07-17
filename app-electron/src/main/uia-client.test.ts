import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { UiaClient, type UiaWorkerRequest } from './uia-client'

class FakeWorker extends EventEmitter {
  postMessage = vi.fn((request: UiaWorkerRequest) => {
    queueMicrotask(() => this.emit('message', { requestId: request.requestId, ok: true, result: request.action === 'enumerate' ? { elements: [], truncated: false } : undefined }))
  })
  terminate = vi.fn(() => Promise.resolve(0))
}

describe('UiaClient', () => {
  it('serializes calls through a worker and returns typed results', async () => {
    const worker = new FakeWorker()
    const client = new UiaClient({ platform: 'win32', workerFactory: () => worker })
    await expect(client.enumerate(77)).resolves.toEqual({ elements: [], truncated: false })
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'enumerate', hwnd: 77, requestId: 'uia-1' }))
    await client.dispose()
  })

  it('preserves structured worker errors', async () => {
    const worker = new FakeWorker()
    worker.postMessage.mockImplementation(request => queueMicrotask(() => worker.emit('message', { requestId: request.requestId, ok: false, error: { code: 'element_stale', message: 'gone' } })))
    const client = new UiaClient({ platform: 'win32', workerFactory: () => worker })
    await expect(client.snapshot(77, 'e1')).rejects.toMatchObject({ code: 'element_stale', message: 'gone' })
  })

  it('times out a blocked worker as control_unavailable', async () => {
    const worker = new FakeWorker()
    worker.postMessage.mockImplementation(() => undefined)
    const client = new UiaClient({ platform: 'win32', timeoutMs: 5, workerFactory: () => worker })
    const failure = client.enumerate(77)
    await expect(failure).rejects.toMatchObject({ code: 'control_unavailable' })
    await expect(failure).rejects.toThrow('timed out')
    await client.dispose()
  })

  it('poisons a hung worker on timeout and spawns a fresh one for the next call', async () => {
    const workers: FakeWorker[] = []
    const factory = vi.fn(() => {
      const worker = new FakeWorker()
      if (workers.length === 0) worker.postMessage.mockImplementation(() => undefined)
      workers.push(worker)
      return worker
    })
    const client = new UiaClient({ platform: 'win32', timeoutMs: 5, workerFactory: factory })
    await expect(client.enumerate(1)).rejects.toMatchObject({ code: 'control_unavailable' })
    expect(workers[0]!.terminate).toHaveBeenCalledTimes(1)
    await expect(client.enumerate(2)).resolves.toEqual({ elements: [], truncated: false })
    expect(factory).toHaveBeenCalledTimes(2)
    await client.dispose()
  })

  it('rejects a concurrent in-flight request when a sibling call times out', async () => {
    const worker = new FakeWorker()
    worker.postMessage.mockImplementation(() => undefined)
    const client = new UiaClient({ platform: 'win32', timeoutMs: 5, workerFactory: () => worker })
    const first = client.enumerate(1)
    const second = client.snapshot(1, 'e1')
    await expect(first).rejects.toMatchObject({ code: 'control_unavailable' })
    await expect(second).rejects.toMatchObject({ code: 'control_unavailable' })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    await client.dispose()
  })

  it('fails cleanly without starting a worker off Windows', async () => {
    const factory = vi.fn(() => new FakeWorker())
    const client = new UiaClient({ platform: 'darwin', workerFactory: factory })
    await expect(client.enumerate(77)).rejects.toMatchObject({ code: 'control_unavailable' })
    expect(factory).not.toHaveBeenCalled()
  })
})
