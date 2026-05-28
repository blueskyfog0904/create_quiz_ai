import type { WorkspaceSubject } from '@/lib/workspace-subject'

export const MARKET_STORAGE_BUCKET = 'market-files'
export const MARKET_ALLOWED_EXTENSIONS = ['pdf', 'hwp', 'zip'] as const
export type MarketAllowedExtension = typeof MARKET_ALLOWED_EXTENSIONS[number]

export interface MarketUploadDescriptor {
  name: string
  size: number
  type?: string | null
}

export interface MarketSubproductUploadFileType {
  code: string
  extension: string
  mime_allowlist?: string[] | null
}

export const MARKET_SAMPLE_PAGE_MIME_TYPE = 'image/jpeg'
export const MAX_SAMPLE_SOURCE_PDF_SIZE = 30 * 1024 * 1024

function normalizeFileName(value: string) {
  return value.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]+/g, '-')
}

export function getMarketFileExtension(fileName: string): string {
  const segments = fileName.toLowerCase().split('.')
  return segments.length > 1 ? segments[segments.length - 1] : ''
}

export function assertMarketUploadIsAllowed(file: MarketUploadDescriptor, assetKind: 'pdf' | 'hwp' | 'zip') {
  const extension = getMarketFileExtension(file.name)

  if (!extension) {
    throw new Error('파일 확장자를 확인할 수 없습니다.')
  }

  if (!MARKET_ALLOWED_EXTENSIONS.includes(extension as MarketAllowedExtension)) {
    throw new Error('문제마켓 업로드는 PDF, HWP 또는 ZIP 파일만 지원합니다.')
  }

  if (assetKind === 'pdf' && extension !== 'pdf') {
    throw new Error('PDF 자산에는 PDF 파일만 업로드할 수 있습니다.')
  }

  if (assetKind === 'hwp' && extension !== 'hwp') {
    throw new Error('HWP 자산에는 HWP 파일만 업로드할 수 있습니다.')
  }

  if (assetKind === 'zip' && extension !== 'zip') {
    throw new Error('ZIP 자산에는 ZIP 파일만 업로드할 수 있습니다.')
  }

  const maxFileSizeBytes = 100 * 1024 * 1024
  if (file.size > maxFileSizeBytes) {
    throw new Error('문제마켓 파일은 100MB 이하만 업로드할 수 있습니다.')
  }
}

export function buildMarketStoragePath(
  workspaceSubject: WorkspaceSubject,
  itemId: string,
  assetKind: 'pdf' | 'hwp' | 'zip',
  fileName: string
) {
  const safeName = normalizeFileName(fileName)
  const timestamp = Date.now()
  return `market/${workspaceSubject}/${itemId}/${assetKind}/${timestamp}-${safeName}`
}

export function assertMarketSubproductUploadIsAllowed(
  file: MarketUploadDescriptor,
  fileType: MarketSubproductUploadFileType
) {
  const extension = getMarketFileExtension(file.name)
  const expectedExtension = fileType.extension.replace(/^\./, '').toLowerCase()

  if (!extension) {
    throw new Error('파일 확장자를 확인할 수 없습니다.')
  }

  if (extension !== expectedExtension) {
    throw new Error(`${fileType.code.toUpperCase()} 파일 유형에는 .${expectedExtension} 파일만 업로드할 수 있습니다.`)
  }

  const allowedMimeTypes = fileType.mime_allowlist ?? []
  if (allowedMimeTypes.length > 0 && file.type && !allowedMimeTypes.includes(file.type)) {
    throw new Error(`${fileType.code.toUpperCase()} 파일 유형에 허용되지 않는 MIME 타입입니다.`)
  }

  const maxFileSizeBytes = 100 * 1024 * 1024
  if (file.size > maxFileSizeBytes) {
    throw new Error('문제마켓 파일은 100MB 이하만 업로드할 수 있습니다.')
  }
}

export function buildMarketSubproductStoragePath(
  workspaceSubject: WorkspaceSubject,
  itemId: string,
  subproductId: string,
  fileTypeCode: string,
  version: number,
  fileName: string
) {
  const safeName = normalizeFileName(fileName)
  const safeCode = normalizeFileName(fileTypeCode.toLowerCase())
  const timestamp = Date.now()
  return `market/${workspaceSubject}/${itemId}/subproducts/${subproductId}/${safeCode}/v${version}/${timestamp}-${safeName}`
}

export function buildMarketSamplePageStoragePath(
  workspaceSubject: WorkspaceSubject,
  itemId: string,
  sourceFileId: string,
  pageNumber: number,
  fileName: string
) {
  const safeName = normalizeFileName(fileName)
  return `market/${workspaceSubject}/${itemId}/sample-pages/${sourceFileId}/page-${String(pageNumber).padStart(3, '0')}-${safeName}`
}

export function assertSampleSourcePdfUploadIsAllowed(file: MarketUploadDescriptor) {
  const extension = getMarketFileExtension(file.name)

  if (extension !== 'pdf') {
    throw new Error('샘플 PDF 업로드에는 PDF 파일만 사용할 수 있습니다.')
  }

  if (file.size > MAX_SAMPLE_SOURCE_PDF_SIZE) {
    throw new Error('샘플 PDF는 30MB 이하만 업로드할 수 있습니다.')
  }
}

export function buildMarketManualSamplePageStoragePath(
  workspaceSubject: WorkspaceSubject,
  itemId: string,
  batchId: string,
  pageNumber: number,
  fileName: string
) {
  const safeName = normalizeFileName(fileName)
  return `market/${workspaceSubject}/${itemId}/sample-pages/manual/${batchId}/page-${String(pageNumber).padStart(3, '0')}-${safeName}`
}
