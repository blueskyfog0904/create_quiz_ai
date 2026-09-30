import sharp from 'sharp'
import { SITE_LOGO_MAX_BYTES, SITE_LOGO_MIME_TYPES, SITE_LOGO_SIZE } from './site-logo'

export async function normalizeSiteLogo(file: File): Promise<Buffer> {
  if (!SITE_LOGO_MIME_TYPES.includes(file.type)) {
    throw new Error('PNG, JPG, WebP 이미지만 업로드할 수 있습니다.')
  }
  if (file.size === 0 || file.size > SITE_LOGO_MAX_BYTES) {
    throw new Error('0바이트보다 크고 5MB 이하인 이미지를 선택해주세요.')
  }

  try {
    const source = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 25_000_000 })
    const metadata = await source.metadata()
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) {
      throw new Error('Unsupported image')
    }
    return await source.rotate().resize(SITE_LOGO_SIZE, SITE_LOGO_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).png().toBuffer()
  } catch {
    throw new Error('이미지를 읽을 수 없습니다. 애니메이션이 아닌 PNG, JPG, WebP 파일(2,500만 픽셀 이하)을 선택해주세요.')
  }
}
