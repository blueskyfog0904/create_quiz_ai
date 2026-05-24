import JSZip from 'jszip'
import {
  HWPX_ALLOWED_XML_ENTRY_PATTERN,
  HWPX_UPLOAD_LIMITS,
  type HwpxExtractedDocument,
} from './hwpx-upload-types'

type ZipObject = JSZip.JSZipObject

type ZipObjectWithSizes = ZipObject & {
  unsafeOriginalName?: string
  _data?: {
    compressedSize?: number
    uncompressedSize?: number
  }
}

const XML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function validateHwpxUploadFile(fileName: string, buffer: Buffer | Uint8Array) {
  if (!fileName.toLowerCase().endsWith('.hwpx')) {
    return { ok: false as const, reason: 'HWPX 파일만 업로드할 수 있습니다.' }
  }

  if (buffer.byteLength > HWPX_UPLOAD_LIMITS.maxFileBytes) {
    return { ok: false as const, reason: 'HWPX 파일은 10MB 이하만 업로드할 수 있습니다.' }
  }

  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return { ok: false as const, reason: '올바른 HWPX ZIP 파일이 아닙니다.' }
  }

  return { ok: true as const }
}

function getZipEntrySizes(entry: ZipObject) {
  const data = (entry as ZipObjectWithSizes)._data
  return {
    compressedSize: data?.compressedSize ?? 0,
    uncompressedSize: data?.uncompressedSize ?? 0,
  }
}

function assertSafePath(path: string, entry?: ZipObject) {
  const unsafeOriginalName = (entry as ZipObjectWithSizes | undefined)?.unsafeOriginalName
  if (path.includes('..') || path.startsWith('/') || unsafeOriginalName?.includes('..') || unsafeOriginalName?.startsWith('/')) {
    throw new Error('허용되지 않는 HWPX 내부 경로입니다.')
  }
}

function assertSafeZipEntry(path: string, entry: ZipObject) {
  assertSafePath(path, entry)

  const { compressedSize, uncompressedSize } = getZipEntrySizes(entry)

  if (uncompressedSize > HWPX_UPLOAD_LIMITS.maxXmlEntryBytes) {
    throw new Error('HWPX XML 항목 크기가 너무 큽니다.')
  }

  if (compressedSize > 0 && uncompressedSize / compressedSize > HWPX_UPLOAD_LIMITS.maxZipCompressionRatio) {
    throw new Error('HWPX XML 압축 비율이 비정상적으로 높습니다.')
  }
}

function decodeXmlText(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, name) => XML_ENTITY_MAP[name] ?? `&${name};`)
}

function extractTextFromSectionXml(xml: string) {
  const parts: string[] = []
  const tokenPattern = /<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>|<hp:lineBreak\b[^>]*\/?>|<hp:tab\b[^>]*\/?>|<hp:p\b[^>]*>/g
  let match: RegExpExecArray | null

  while ((match = tokenPattern.exec(xml)) !== null) {
    const token = match[0]

    if (token.startsWith('<hp:t')) {
      parts.push(decodeXmlText(match[1].replace(/<[^>]+>/g, '')))
      continue
    }

    if (token.startsWith('<hp:tab')) {
      parts.push('\t')
      continue
    }

    parts.push('\n')
  }

  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function extractHwpxTextFromBuffer(buffer: Buffer | Uint8Array): Promise<HwpxExtractedDocument> {
  const zip = await JSZip.loadAsync(buffer)
  const entries = Object.keys(zip.files)

  if (entries.length > HWPX_UPLOAD_LIMITS.maxZipEntries) {
    throw new Error('HWPX 내부 파일 수가 너무 많습니다.')
  }

  for (const path of entries) {
    assertSafePath(path, zip.files[path])
  }

  const sectionPaths = entries
    .filter((entry) => HWPX_ALLOWED_XML_ENTRY_PATTERN.test(entry) && !zip.files[entry].dir)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  if (sectionPaths.length === 0) {
    throw new Error('HWPX 본문 XML을 찾을 수 없습니다.')
  }

  let totalXmlBytes = 0
  for (const path of sectionPaths) {
    assertSafeZipEntry(path, zip.files[path])
    totalXmlBytes += getZipEntrySizes(zip.files[path]).uncompressedSize
  }

  if (totalXmlBytes > HWPX_UPLOAD_LIMITS.maxXmlBytes) {
    throw new Error('HWPX XML 크기가 너무 큽니다.')
  }

  const sections = []

  for (const path of sectionPaths) {
    const xml = await zip.files[path].async('string')
    const text = extractTextFromSectionXml(xml)
    if (text) {
      sections.push({ path, text })
    }
  }

  const text = sections.map((section) => section.text).join('\n\n').trim()

  if (!text) {
    throw new Error('HWPX에서 추출 가능한 텍스트가 없습니다.')
  }

  if (text.length > HWPX_UPLOAD_LIMITS.maxExtractedChars) {
    throw new Error('추출된 텍스트가 너무 깁니다. 문서를 나누어 업로드해주세요.')
  }

  return { text, sections, warnings: [] }
}
