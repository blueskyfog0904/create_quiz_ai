export const MAX_SAMPLE_PAGE_PIXELS = 12_000_000
export const MAX_SAMPLE_PAGE_DIMENSION_PX = 5_000
export const MAX_GENERATED_SAMPLE_PAGE_COUNT = 12
export const MAX_GENERATED_SAMPLE_PAGE_BYTES = 3 * 1024 * 1024
export const MAX_GENERATED_SAMPLE_TOTAL_BYTES = 9 * 1024 * 1024
export const MAX_SAMPLE_ORIGINAL_FILE_NAME_LENGTH = 180
export const SAMPLE_PDF_DOCUMENT_LOAD_TIMEOUT_MS = 10_000
export const SAMPLE_PDF_PAGE_RENDER_TIMEOUT_MS = 10_000

export function buildMarketSamplePageFileName(sourceFileName: string, pageNumber: number) {
  const baseName = sourceFileName.replace(/\.[^.]+$/, '') || 'sample'
  const suffix = `-sample-page-${String(pageNumber).padStart(3, '0')}.jpg`
  const maxBaseNameLength = Math.max(1, MAX_SAMPLE_ORIGINAL_FILE_NAME_LENGTH - suffix.length)
  return `${baseName.slice(0, maxBaseNameLength)}${suffix}`
}

export function parseMarketSamplePageSelection(input: string, maxPageCount?: number): number[] {
  const rawValues = input
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (rawValues.length === 0) {
    throw new Error('샘플로 생성할 페이지 번호를 입력해주세요.')
  }

  const pageNumbers = rawValues.map((value) => {
    if (!/^\d+$/.test(value)) {
      throw new Error('샘플 페이지 번호는 1 이상의 정수여야 합니다.')
    }

    return Number(value)
  })
  const dedupedPageNumbers = Array.from(new Set(pageNumbers))

  if (dedupedPageNumbers.length > MAX_GENERATED_SAMPLE_PAGE_COUNT) {
    throw new Error(`샘플 페이지는 최대 ${MAX_GENERATED_SAMPLE_PAGE_COUNT}장까지 생성할 수 있습니다.`)
  }

  for (const pageNumber of dedupedPageNumbers) {
    if (pageNumber < 1) {
      throw new Error('샘플 페이지 번호는 1 이상의 정수여야 합니다.')
    }

    if (maxPageCount !== undefined && pageNumber > maxPageCount) {
      throw new Error('샘플 페이지 번호가 PDF 전체 페이지 수를 초과했습니다.')
    }
  }

  return dedupedPageNumbers
}
