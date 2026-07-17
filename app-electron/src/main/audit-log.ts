import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AuditEntry } from '../shared/contracts'
import { auditDir, auditLogPath, auditThumbnailsDir } from './paths'
import { publish } from './streams'

export type NewAuditEntry = Omit<AuditEntry, 'id' | 'timestamp'> & Partial<Pick<AuditEntry, 'id' | 'timestamp'>>

export class AuditLog {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private thumbnailRetention: () => number = () => 100) {}

  append(entry: NewAuditEntry, thumbnail?: Buffer): Promise<AuditEntry> {
    const id = entry.id ?? randomUUID()
    const keepThumbnail = Boolean(thumbnail) && this.thumbnailRetention() > 0
    const complete: AuditEntry = {
      id,
      timestamp: entry.timestamp ?? Date.now(),
      client: entry.client,
      action: entry.action,
      source: entry.source,
      sourceKind: entry.sourceKind,
      changed: entry.changed,
      hash: entry.hash,
      bytes: entry.bytes,
      thumbnail: keepThumbnail ? id : entry.thumbnail,
      error: entry.error,
      ...(entry.target === undefined ? {} : { target: entry.target }),
      ...(entry.method === undefined ? {} : { method: entry.method }),
      ...(entry.outcome === undefined ? {} : { outcome: entry.outcome }),
    }
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(auditDir(), { recursive: true })
      if (keepThumbnail && thumbnail) {
        await mkdir(auditThumbnailsDir(), { recursive: true })
        await writeFile(join(auditThumbnailsDir(), `${id}.jpg`), thumbnail)
        await this.pruneThumbnails(id)
      }
      await appendFile(auditLogPath(), `${JSON.stringify(complete)}\n`, 'utf8')
    })
    return this.writeQueue.then(() => {
      publish('audit:entry', complete)
      return structuredClone(complete)
    })
  }

  async thumbnail(entryId: string): Promise<string | null> {
    if (!/^[0-9a-f-]{36}$/i.test(entryId)) throw new TypeError('Invalid audit entry id')
    await this.writeQueue
    try {
      const data = await readFile(join(auditThumbnailsDir(), `${entryId}.jpg`))
      return `data:image/jpeg;base64,${data.toString('base64')}`
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async list(limit = 200): Promise<AuditEntry[]> {
    await this.writeQueue
    try {
      const lines = (await readFile(auditLogPath(), 'utf8')).trim().split(/\r?\n/).filter(Boolean)
      return lines.slice(-Math.max(1, limit)).map(line => JSON.parse(line) as AuditEntry).reverse()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private async pruneThumbnails(currentId: string): Promise<void> {
    const retention = Math.max(0, Math.floor(this.thumbnailRetention()))
    const names = (await readdir(auditThumbnailsDir())).filter(name => name.endsWith('.jpg'))
    const files = await Promise.all(names.map(async name => ({ name, modifiedAt: (await stat(join(auditThumbnailsDir(), name))).mtimeMs })))
    files.sort((left, right) => left.name === `${currentId}.jpg` ? -1 : right.name === `${currentId}.jpg` ? 1 : right.modifiedAt - left.modifiedAt)
    await Promise.all(files.slice(retention).map(file => rm(join(auditThumbnailsDir(), file.name), { force: true })))
  }
}
