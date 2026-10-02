// 관리자 이미지 라이브러리 클라이언트 요청·업로드 흐름. fetch·해시·축소 함수를 주입받아 node 테스트에서도 돌린다.
import {
  MARKET_IMAGE_MAX_CHECK_HASHES,
  chunkArray,
  chunkMarketImageUploads,
  type MarketImageDto,
} from '@/lib/market-images'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const NETWORK_ERROR_MESSAGE = '네트워크 오류로 요청하지 못했습니다. 잠시 후 다시 시도해주세요.'

export function getMarketImageErrorMessage(result: unknown, fallback: string) {
  const message = (result as { error?: { message?: unknown } } | null)?.error?.message
  return typeof message === 'string' ? message : fallback
}

// 네트워크 오류도 실패 결과로 돌려줘 호출부가 진행 상태를 풀고 목록을 다시 읽을 수 있게 한다.
export async function requestMarketImageJson(
  url: string,
  init?: RequestInit,
  fetchImpl: FetchLike = (input, requestInit) => fetch(input, requestInit),
) {
  try {
    const response = await fetchImpl(url, { cache: 'no-store', ...init })
    const result = await response.json().catch(() => null)
    return { ok: response.ok && Boolean(result?.success), result }
  } catch {
    return { ok: false, result: { success: false, error: { code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE } } }
  }
}

export function jsonRequestInit(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export async function sha256HexOfBlob(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface MarketImageUploadDeps {
  fetch?: FetchLike
  // 보낼 바이트를 만든다(4MB 초과 파일 축소). 실패하면 그 파일만 실패로 기록한다.
  prepare: (file: File) => Promise<File>
  hash: (file: Blob) => Promise<string>
}

export interface MarketImageUploadOutcome {
  // 입력 순서대로 성공한 이미지(재사용 포함). 선택 모드는 첫 번째를 고른다.
  images: MarketImageDto[]
  reusedCount: number
  failures: { name: string; error: string }[]
}

// 보낼 바이트의 SHA-256으로 먼저 확인해 이미 있는 이미지는 올리지 않고,
// 나머지는 요청당 파일 수·합계 바이트 한도에 맞춰 나눠 올린다(D4, 8절).
export async function uploadMarketImageFiles(
  files: File[],
  folderId: string | null,
  deps: MarketImageUploadDeps,
): Promise<MarketImageUploadOutcome> {
  const request = (url: string, init?: RequestInit) => requestMarketImageJson(url, init, deps.fetch)
  const failures: MarketImageUploadOutcome['failures'] = []
  const imagesByIndex = new Map<number, MarketImageDto>()
  let reusedCount = 0

  const prepared: { index: number; file: File; hash: string }[] = []
  for (const [index, original] of files.entries()) {
    try {
      const file = await deps.prepare(original)
      prepared.push({ index, file, hash: await deps.hash(file) })
    } catch (error) {
      failures.push({ name: original.name, error: error instanceof Error ? error.message : '이미지를 읽을 수 없습니다.' })
    }
  }

  const known = new Map<string, MarketImageDto>()
  for (const hashes of chunkArray([...new Set(prepared.map((entry) => entry.hash))], MARKET_IMAGE_MAX_CHECK_HASHES)) {
    const { ok, result } = await request('/api/admin/market/images/check', jsonRequestInit('POST', { hashes }))
    if (!ok) throw new Error(getMarketImageErrorMessage(result, '이미지 중복 여부를 확인하지 못했습니다.'))
    for (const match of result.data.matches as { hash: string; image: MarketImageDto }[]) known.set(match.hash, match.image)
  }

  const pending: { index: number; file: File; size: number }[] = []
  for (const entry of prepared) {
    const image = known.get(entry.hash)
    if (image) {
      imagesByIndex.set(entry.index, image)
      reusedCount += 1
    } else {
      pending.push({ index: entry.index, file: entry.file, size: entry.file.size })
    }
  }

  for (const batch of chunkMarketImageUploads(pending)) {
    const body = new FormData()
    for (const entry of batch) body.append('files', entry.file)
    if (folderId) body.append('folderId', folderId)
    const { ok, result } = await request('/api/admin/market/images', { method: 'POST', body })
    if (!ok) {
      const error = getMarketImageErrorMessage(result, '이미지를 업로드하지 못했습니다.')
      failures.push(...batch.map((entry) => ({ name: entry.file.name, error })))
      continue
    }
    // 서버는 보낸 순서대로 파일별 결과를 돌려준다.
    const results = result.data.results as ({ name: string; image: MarketImageDto; duplicated: boolean } | { name: string; error: string })[]
    batch.forEach((entry, position) => {
      const item = results[position]
      if (item && 'image' in item) {
        imagesByIndex.set(entry.index, item.image)
        if (item.duplicated) reusedCount += 1
      } else {
        failures.push({ name: entry.file.name, error: item?.error ?? '이미지를 업로드하지 못했습니다.' })
      }
    })
  }

  const images = [...imagesByIndex.entries()].sort(([a], [b]) => a - b).map(([, image]) => image)
  return { images, reusedCount, failures }
}
