import type { WorkspaceSubject } from '@/lib/workspace-subject'

export const MARKET_STORAGE_BUCKET = 'market-files'
export const MARKET_ALLOWED_EXTENSIONS = ['pdf', 'hwp'] as const
export type MarketAllowedExtension = typeof MARKET_ALLOWED_EXTENSIONS[number]

export interface MarketUploadDescriptor {
  name: string
  size: number
  type?: string | null
}

function normalizeFileName(value: string) {
  return value.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]+/g, '-')
}

export function getMarketFileExtension(fileName: string): string {
  const segments = fileName.toLowerCase().split('.')
  return segments.length > 1 ? segments[segments.length - 1] : ''
}

export function assertMarketUploadIsAllowed(file: MarketUploadDescriptor, assetKind: 'sample' | 'pdf' | 'hwp') {
  const extension = getMarketFileExtension(file.name)

  if (!extension) {
    throw new Error('파일 확장자를 확인할 수 없습니다.')
  }

  if (!MARKET_ALLOWED_EXTENSIONS.includes(extension as MarketAllowedExtension)) {
    throw new Error('문제마켓 업로드는 PDF 또는 HWP 파일만 지원합니다.')
  }

  if (assetKind === 'sample' && extension !== 'pdf') {
    throw new Error('샘플 파일은 PDF만 허용합니다.')
  }

  if (assetKind === 'pdf' && extension !== 'pdf') {
    throw new Error('PDF 자산에는 PDF 파일만 업로드할 수 있습니다.')
  }

  if (assetKind === 'hwp' && extension !== 'hwp') {
    throw new Error('HWP 자산에는 HWP 파일만 업로드할 수 있습니다.')
  }

  const maxFileSizeBytes = 100 * 1024 * 1024
  if (file.size > maxFileSizeBytes) {
    throw new Error('문제마켓 파일은 100MB 이하만 업로드할 수 있습니다.')
  }
}

export function buildMarketStoragePath(
  workspaceSubject: WorkspaceSubject,
  itemId: string,
  assetKind: 'sample' | 'pdf' | 'hwp',
  fileName: string
) {
  const safeName = normalizeFileName(fileName)
  const timestamp = Date.now()
  return `market/${workspaceSubject}/${itemId}/${assetKind}/${timestamp}-${safeName}`
}
