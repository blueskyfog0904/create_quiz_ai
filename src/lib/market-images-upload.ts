// 관리자 이미지 라이브러리 클라이언트 요청·업로드 흐름. fetch·해시·축소 함수를 주입받아 node 테스트에서도 돌린다.
import {
  MARKET_IMAGE_MAX_CHECK_HASHES,
  MARKET_IMAGE_MAX_EDGE,
  MARKET_IMAGE_MAX_INPUT_BYTES,
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

// 브라우저 전용(호출 시점에만 DOM·localStorage를 쓴다). 라이브러리·상품·카테고리 화면이 함께 쓴다.
// 마지막으로 보거나 올린 폴더(G4): 'all' | 'unfiled' | 폴더 id
const LAST_FOLDER_STORAGE_KEY = 'market-image-library:last-folder'
// 입력 한도(4MB)를 넘는 파일만 브라우저에서 줄여 보낸다. 서버가 다시 긴 변 800px WebP로 정규화한다.
const PRESHRINK_MAX_EDGE = MARKET_IMAGE_MAX_EDGE * 2

export function readLastMarketImageFolder() {
  try {
    return window.localStorage.getItem(LAST_FOLDER_STORAGE_KEY)
  } catch {
    return null
  }
}

export function writeLastMarketImageFolder(folder: string) {
  try {
    window.localStorage.setItem(LAST_FOLDER_STORAGE_KEY, folder)
  } catch {
    // 저장소를 쓸 수 없으면 기억하지 않는다.
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9))
}

// 입력 한도(4MB)를 넘는 파일만 줄인다. WebP를 못 만드는 브라우저(Safari는 PNG로 대체)나 여전히 크면 JPEG로,
// 그래도 크면 긴 변을 줄여 다시 시도한다. JPEG는 투명 영역을 흰 배경으로 채운다.
export async function shrinkMarketImageForUpload(file: File) {
  if (file.size <= MARKET_IMAGE_MAX_INPUT_BYTES) return file
  const bitmap = await createImageBitmap(file)
  try {
    for (let maxEdge = PRESHRINK_MAX_EDGE; maxEdge >= MARKET_IMAGE_MAX_EDGE; maxEdge = Math.round(maxEdge * 0.75)) {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) break
      for (const type of ['image/webp', 'image/jpeg']) {
        context.clearRect(0, 0, canvas.width, canvas.height)
        if (type === 'image/jpeg') {
          context.fillStyle = 'white'
          context.fillRect(0, 0, canvas.width, canvas.height)
        }
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const blob = await canvasToBlob(canvas, type)
        if (blob && blob.type === type && blob.size <= MARKET_IMAGE_MAX_INPUT_BYTES) {
          return new File([blob], file.name, { type })
        }
      }
    }
  } finally {
    bitmap.close()
  }
  throw new Error('4MB 이하로 줄이지 못했습니다. 더 작은 이미지를 선택해주세요.')
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
  // 지정한 폴더가 없어 미분류로 올렸는지
  folderFallback: boolean
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

  let targetFolderId = folderId
  let folderFallback = false
  const postBatch = (batch: typeof pending) => {
    const body = new FormData()
    for (const entry of batch) body.append('files', entry.file)
    if (targetFolderId) body.append('folderId', targetFolderId)
    return request('/api/admin/market/images', { method: 'POST', body })
  }

  for (const batch of chunkMarketImageUploads(pending)) {
    let { ok, result } = await postBatch(batch)
    // 기억한 폴더가 그사이 삭제됐으면 미분류로 다시 올린다(호출부가 기억한 폴더를 지운다).
    if (!ok && result?.error?.code === 'FOLDER_NOT_FOUND' && targetFolderId) {
      targetFolderId = null
      folderFallback = true
      ;({ ok, result } = await postBatch(batch))
    }
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
  return { images, reusedCount, failures, folderFallback }
}
