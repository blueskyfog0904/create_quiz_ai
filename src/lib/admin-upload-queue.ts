// 18번 7절(G-05): 관리자 판매 파일 올리기 진행 표시의 순수 상태 전이.
// 파일마다 대기 → 준비(prepare) → 올리는 중(n%) → 등록(complete) → 완료 / 실패(단계·사유). 한 번에 1개씩 차례로 올린다.
// [다시 시도]는 그 파일만 다시 한다(완료된 파일은 다시 보내지 않는다). 준비·올리기 실패는 준비부터, 등록(complete) 실패는
// 이미 올린 같은 경로로 등록만 다시 한다(서버가 이미 등록했으면 409 ALREADY_REGISTERED = 완료, 파일이 없으면 UPLOAD_NOT_FOUND → 준비부터). 놓는 순간 크기·형식을 미리 검사해 '건너뜀'으로 둔다
// (서버 검사는 그대로 — 이 검사는 화면 안내용이다).

export type UploadPhase = 'waiting' | 'preparing' | 'uploading' | 'registering' | 'done' | 'failed' | 'skipped'
export type UploadStep = 'prepare' | 'upload' | 'complete'
export type UploadSkipReason = 'too_large' | 'unsupported_type'

export interface UploadQueueEntry {
  id: string
  fileName: string
  size: number
  fileTypeId: string | null
  phase: UploadPhase
  progress: number
  failedStep: UploadStep | null
  error: string | null
  skipReason: UploadSkipReason | null
  // prepare 가 준 Storage 경로(등록 다시 시도에 쓴다)
  storagePath: string | null
  // 다음 시작을 등록(complete)부터 한다(등록 실패 뒤 [다시 시도])
  resumeFromComplete: boolean
}

export type UploadEvent =
  | { type: 'start' }
  | { type: 'prepared'; storagePath: string }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'uploaded' }
  | { type: 'registered' }
  | { type: 'fail'; step: UploadStep; message: string }
  | { type: 'retry' }
  // 등록 다시 시도 중 서버에 파일이 없음(UPLOAD_NOT_FOUND) → 준비부터
  | { type: 'restart' }

export interface UploadFileLike {
  name: string
  size: number
}

// 놓은 파일들을 대기 줄로 만든다. 크기가 상한을 넘거나 형식이 맞지 않으면 '건너뜀'(보내지 않음).
export function createUploadEntries<F extends UploadFileLike>(
  files: F[],
  options: { maxBytes: number; resolveFileTypeId: (file: F) => string | null; makeId: (index: number) => string }
): UploadQueueEntry[] {
  return files.map((file, index) => {
    const fileTypeId = options.resolveFileTypeId(file)
    const skipReason: UploadSkipReason | null = file.size > options.maxBytes ? 'too_large' : !fileTypeId ? 'unsupported_type' : null
    return {
      id: options.makeId(index),
      fileName: file.name,
      size: file.size,
      fileTypeId,
      phase: skipReason ? 'skipped' : 'waiting',
      progress: 0,
      failedStep: null,
      error: null,
      skipReason,
      storagePath: null,
      resumeFromComplete: false,
    }
  })
}

// 이벤트 하나를 적용한다. 지금 단계에서 맞지 않는 이벤트는 무시한다(같은 값을 돌려줌).
export function applyUploadEvent(entry: UploadQueueEntry, event: UploadEvent): UploadQueueEntry {
  switch (event.type) {
    case 'start':
      if (entry.phase !== 'waiting') return entry
      return entry.resumeFromComplete && entry.storagePath
        ? { ...entry, phase: 'registering', progress: 100, failedStep: null, error: null }
        : { ...entry, phase: 'preparing', progress: 0, failedStep: null, error: null, storagePath: null, resumeFromComplete: false }
    case 'prepared':
      return entry.phase === 'preparing' ? { ...entry, phase: 'uploading', progress: 0, storagePath: event.storagePath } : entry
    case 'progress': {
      if (entry.phase !== 'uploading' || event.total <= 0) return entry
      // 다 보낸 뒤 서버 응답을 기다리는 동안 100% 로 보이지 않게 99% 에서 멈춘다(100% 는 올리기 끝).
      const percent = Math.min(99, Math.max(entry.progress, Math.floor((event.loaded / event.total) * 100)))
      return percent === entry.progress ? entry : { ...entry, progress: percent }
    }
    case 'uploaded':
      return entry.phase === 'uploading' ? { ...entry, phase: 'registering', progress: 100 } : entry
    case 'registered':
      return entry.phase === 'registering' ? { ...entry, phase: 'done', progress: 100 } : entry
    case 'fail': {
      const expected: Record<UploadStep, UploadPhase> = { prepare: 'preparing', upload: 'uploading', complete: 'registering' }
      if (entry.phase !== expected[event.step]) return entry
      return { ...entry, phase: 'failed', failedStep: event.step, error: event.message }
    }
    case 'retry':
      // 실패한 파일만 다시 대기로. 등록 실패이고 경로가 있으면 등록부터, 아니면 준비부터. 완료·건너뜀은 그대로.
      if (entry.phase !== 'failed') return entry
      return {
        ...entry,
        phase: 'waiting',
        progress: 0,
        resumeFromComplete: entry.failedStep === 'complete' && Boolean(entry.storagePath),
        failedStep: null,
        error: null,
      }
    case 'restart':
      return entry.phase === 'registering'
        ? { ...entry, phase: 'preparing', progress: 0, storagePath: null, resumeFromComplete: false }
        : entry
    default:
      return entry
  }
}

export function updateUploadEntry(entries: UploadQueueEntry[], id: string, event: UploadEvent): UploadQueueEntry[] {
  let changed = false
  const next = entries.map((entry) => {
    if (entry.id !== id) return entry
    const updated = applyUploadEvent(entry, event)
    if (updated !== entry) changed = true
    return updated
  })
  return changed ? next : entries
}

// 다음에 올릴 파일(대기 중 첫 번째). 다른 파일이 올라가는 중이면 없음(한 번에 1개씩).
export function nextUploadEntry(entries: UploadQueueEntry[]): UploadQueueEntry | null {
  if (entries.some((entry) => entry.phase === 'preparing' || entry.phase === 'uploading' || entry.phase === 'registering')) return null
  return entries.find((entry) => entry.phase === 'waiting') ?? null
}

export interface UploadSummary {
  total: number
  done: number
  failed: number
  skipped: number
  active: boolean
  // 화면 읽기 프로그램용 한 줄(aria-live): "3개 중 2개 완료"
  text: string
}

export function summarizeUploads(entries: UploadQueueEntry[]): UploadSummary {
  const total = entries.filter((entry) => entry.phase !== 'skipped').length
  const done = entries.filter((entry) => entry.phase === 'done').length
  const failed = entries.filter((entry) => entry.phase === 'failed').length
  const skipped = entries.filter((entry) => entry.phase === 'skipped').length
  const active = entries.some((entry) => ['waiting', 'preparing', 'uploading', 'registering'].includes(entry.phase))
  const parts = [`${total}개 중 ${done}개 완료`]
  if (failed > 0) parts.push(`실패 ${failed}개`)
  if (skipped > 0) parts.push(`건너뜀 ${skipped}개`)
  return { total, done, failed, skipped, active, text: parts.join(' · ') }
}

// 모두 끝났는가(대기·진행 없음)
export function isUploadQueueSettled(entries: UploadQueueEntry[]) {
  return !summarizeUploads(entries).active
}

export function formatUploadBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// 놓는 칸 아래 안내: 허용 형식은 DB 파일 유형 목록(표시명)에서, 상한은 Storage 버킷 상한에서 만든다. 예: "PDF·HWP·ZIP, 파일당 50MB까지"
export function formatUploadLimitText(fileTypeLabels: string[], maxBytes: number) {
  const labels = [...new Set(fileTypeLabels.map((label) => label.trim()).filter(Boolean))]
  const megabytes = Math.floor(maxBytes / (1024 * 1024))
  return `${labels.length > 0 ? labels.join('·') : '등록된 파일 유형 없음'}, 파일당 ${megabytes}MB까지`
}

export const UPLOAD_PHASE_LABELS: Record<UploadPhase, string> = {
  waiting: '대기',
  preparing: '준비 중',
  uploading: '올리는 중',
  registering: '등록 중',
  done: '완료',
  failed: '실패',
  skipped: '건너뜀',
}

export const UPLOAD_STEP_LABELS: Record<UploadStep, string> = {
  prepare: '준비',
  upload: '올리기',
  complete: '등록',
}

export function describeUploadEntry(entry: UploadQueueEntry, maxBytes: number) {
  if (entry.phase === 'skipped') {
    return entry.skipReason === 'too_large' ? `건너뜀(${Math.floor(maxBytes / (1024 * 1024))}MB 초과)` : '건너뜀(허용 형식 아님)'
  }
  if (entry.phase === 'uploading') return `${UPLOAD_PHASE_LABELS.uploading} ${entry.progress}%`
  if (entry.phase === 'failed') {
    return `${UPLOAD_PHASE_LABELS.failed}(${entry.failedStep ? UPLOAD_STEP_LABELS[entry.failedStep] : ''}${entry.error ? `: ${entry.error}` : ''})`
  }
  return UPLOAD_PHASE_LABELS[entry.phase]
}
