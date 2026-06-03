import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  formatDateTime,
  formatDurationMs,
  getEventLabel,
  getStatusLabel,
  groupLogsByAttemptNo,
  safeJsonStringify,
  type SafeAttemptLog,
} from './log-viewer-utils'

type QuestionGenerationAttemptLogViewerProps = {
  attempts: SafeAttemptLog[]
  emptyMessage?: string
  defaultOpenFailed?: boolean
  defaultOpenLastAttempt?: boolean
}

const statusVariant = (status: string | null) => (
  status === 'failed' ? 'destructive' : status === 'success' ? 'default' : 'secondary'
)

export function QuestionGenerationAttemptLogViewer({
  attempts,
  emptyMessage = '저장된 상세 진행 로그가 없습니다.',
  defaultOpenFailed = true,
  defaultOpenLastAttempt = true,
}: QuestionGenerationAttemptLogViewerProps) {
  const groups = groupLogsByAttemptNo(attempts)

  if (groups.length === 0) {
    return <p className="text-sm text-gray-500">{emptyMessage}</p>
  }

  return (
    <div className="space-y-4">
      {groups.map((group, groupIndex) => {
        const isLastGroup = groupIndex === groups.length - 1
        const hasFailedLog = group.logs.some((log) => log.status === 'failed')
        const groupOpen = (defaultOpenFailed && hasFailedLog) || (defaultOpenLastAttempt && isLastGroup)
        const groupTitle = group.attemptNo === null ? '회차 미기록' : `${group.attemptNo}회차`

        return (
          <Card key={`${groupTitle}-${groupIndex}`} className="gap-4 py-4 shadow-none">
            <CardHeader className="px-4">
              <CardTitle className="text-base">{groupTitle}</CardTitle>
              <CardDescription>{group.logs.length.toLocaleString()}개 이벤트</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4">
              {group.logs.map((log, logIndex) => {
                const eventLabel = getEventLabel(log.event)
                const timestamp = formatDateTime(log.timestamp)
                const duration = formatDurationMs(log.durationMs)
                const logOpen = (defaultOpenFailed && log.status === 'failed') || groupOpen

                return (
                  <details
                    key={log.id || `${groupIndex}-${logIndex}-${log.event}`}
                    className="rounded-lg border bg-white p-3"
                    open={logOpen}
                  >
                    <summary className="cursor-pointer list-none space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900">{eventLabel}</span>
                        <Badge variant={statusVariant(log.status)}>{getStatusLabel(log.status)}</Badge>
                        {timestamp && <span className="text-xs text-gray-500">{timestamp}</span>}
                        {duration && <span className="text-xs text-gray-500">{duration}</span>}
                      </div>
                      {log.title && <p className="text-xs text-gray-500">{log.title}</p>}
                    </summary>
                    <div className="mt-3 space-y-3 text-sm">
                      <div className="grid gap-2 text-xs text-gray-500 md:grid-cols-3">
                        <div><span className="font-medium text-gray-700">phase</span> {log.phase || '-'}</div>
                        <div><span className="font-medium text-gray-700">event</span> {log.event}</div>
                        <div><span className="font-medium text-gray-700">id</span> {log.id || '-'}</div>
                      </div>
                      {log.rawText && (
                        <details className="rounded border bg-gray-50 p-3">
                          <summary className="cursor-pointer font-medium">원본 텍스트 보기</summary>
                          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-800">{log.rawText}</pre>
                        </details>
                      )}
                      {log.payload !== undefined && (
                        <details className="rounded border bg-gray-50 p-3">
                          <summary className="cursor-pointer font-medium">payload JSON 보기</summary>
                          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-800">{safeJsonStringify(log.payload)}</pre>
                        </details>
                      )}
                    </div>
                  </details>
                )
              })}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
