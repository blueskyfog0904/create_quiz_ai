import { RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { describeUploadEntry, formatUploadBytes, summarizeUploads, type UploadQueueEntry } from '@/lib/admin-upload-queue'
import { MAX_MARKET_SUBPRODUCT_FILE_SIZE } from '@/lib/market-storage'

// 18번 8절: 업로드 행 — 파일마다 이름·크기·진행 막대(%)·상태·[다시 시도]·[빼기]. 화면 읽기 프로그램용 요약 한 줄(aria-live).
// busy: 이 행을 올리는 중 — [다시 시도]·[빼기]를 막는다(처리가 끝난 뒤 누른다).
export function UploadQueueList({ entries, busy, onRetry, onRemove }: {
  entries: UploadQueueEntry[]
  busy: boolean
  onRetry: (entryId: string) => void
  onRemove: (entryId: string) => void
}) {
  const summary = summarizeUploads(entries)
  if (entries.length === 0) return null

  return (
    <div className="space-y-2">
      <p aria-live="polite" className="text-xs font-medium text-gray-700">{summary.text}</p>
      <ul className="space-y-1.5">
        {entries.map((entry) => {
          const isActive = entry.phase === 'preparing' || entry.phase === 'uploading' || entry.phase === 'registering'
          const tone = entry.phase === 'done'
            ? 'text-emerald-700'
            : entry.phase === 'failed'
              ? 'text-red-700'
              : entry.phase === 'skipped'
                ? 'text-amber-700'
                : 'text-gray-600'
          return (
            <li key={entry.id} className="rounded-md border bg-white px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900">{entry.fileName}</p>
                  <p className={tone}>{formatUploadBytes(entry.size)} · {describeUploadEntry(entry, MAX_MARKET_SUBPRODUCT_FILE_SIZE)}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {entry.phase === 'failed' ? (
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => onRetry(entry.id)}>
                      <RotateCcw className="mr-1 h-3 w-3" />
                      다시 시도
                    </Button>
                  ) : null}
                  {isActive ? null : (
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" aria-label={`${entry.fileName} 빼기`} disabled={busy} onClick={() => onRemove(entry.id)}>
                      <X className="mr-1 h-3 w-3" />
                      빼기
                    </Button>
                  )}
                </div>
              </div>
              {entry.phase === 'skipped' ? null : (
                <div
                  role="progressbar"
                  aria-label={`${entry.fileName} 진행률`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={entry.progress}
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100"
                >
                  <div
                    className={`h-full transition-all ${entry.phase === 'failed' ? 'bg-red-400' : entry.phase === 'done' ? 'bg-emerald-500' : 'bg-gray-900'}`}
                    style={{ width: `${entry.progress}%` }}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
