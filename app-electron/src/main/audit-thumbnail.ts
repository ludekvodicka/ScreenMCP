import sharp from 'sharp'

export async function createAuditThumbnail(encoded: Buffer): Promise<Buffer> {
  return sharp(encoded).resize({ width: 960, height: 600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 65 }).toBuffer()
}
