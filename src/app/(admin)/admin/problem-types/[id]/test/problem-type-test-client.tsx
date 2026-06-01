'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { PassageSelectorModal } from '@/components/features/passages/passage-selector-modal'
import type { Passage } from '@/app/api/passages/actions'
import { QuestionPreview } from '@/components/features/quiz/question-preview'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import type { Database } from '@/types/supabase'
import type { Question, QuestionGenerationAttemptLog, ReviewResult } from '@/lib/ai/types'

const LOG_EVENT_LABELS: Record<QuestionGenerationAttemptLog['event'], string> = {
  generation_started: '문제 생성 시작 시점',
  generation_request_prompt: '문제 생성 API 요청 프롬프트 전체',
  generation_response: '문제 생성 API 응답 전체',
  review_request_payload: '검토 API 전달 데이터 전체',
  review_response: '검토 API 검토 내용 및 결과 값',
  review_failed_feedback_to_generation: '이전 문제 + 피드백 전달값 전체',
  regeneration_request_prompt: '피드백 기반 재요청 프롬프트 전체',
  regeneration_response: '재생성된 문제 응답값',
  loop_finished: '루프 종료',
  loop_failed: '루프 실패',
}

type ProblemType = Database['public']['Tables']['problem_types']['Row']

type TestResponse = {
  success: boolean
  status: string
  finalQuestion?: Question
  lastQuestion?: Question
  finalReview?: ReviewResult
  attempts?: QuestionGenerationAttemptLog[]
  stopReason?: string
  error?: { message?: string }
}

interface ProblemTypeTestClientProps {
  problemType: ProblemType
  workspaceSubject: WorkspaceSubject
}

export default function ProblemTypeTestClient({ problemType, workspaceSubject }: ProblemTypeTestClientProps) {
  const [passage, setPassage] = useState('')
  const [gradeLevel, setGradeLevel] = useState('High1')
  const [difficulty, setDifficulty] = useState('Medium')
  const [maxAttempts, setMaxAttempts] = useState('3')
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResponse | null>(null)

  const groupedLogs = useMemo(() => {
    const logs = result?.attempts ?? []
    return logs.reduce<Record<number, QuestionGenerationAttemptLog[]>>((acc, log) => {
      acc[log.attemptNo] = acc[log.attemptNo] || []
      acc[log.attemptNo].push(log)
      return acc
    }, {})
  }, [result?.attempts])

  const handleSelectPassage = (selectedPassage: Passage) => {
    setPassage(selectedPassage.content || '')
    toast.success('기존 등록 지문을 불러왔습니다')
  }

  const handleRunTest = async () => {
    if (!passage.trim()) {
      toast.error('테스트용 지문을 입력하거나 불러와주세요')
      return
    }

    try {
      setTesting(true)
      setResult(null)
      const response = await fetch(`/api/admin/problem-types/${problemType.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passage,
          gradeLevel,
          difficulty,
          maxAttempts: Number(maxAttempts),
          workspaceSubject,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error?.message || '테스트 실행에 실패했습니다')
      }

      setResult(data)
      if (data.success) {
        toast.success('문제 생성-검토 루프가 통과되었습니다')
      } else {
        toast.warning('문제 생성-검토 루프가 통과되지 않았습니다')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '테스트 실행 중 오류가 발생했습니다')
    } finally {
      setTesting(false)
    }
  }

  const previewQuestion = result?.finalQuestion || result?.lastQuestion

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={withAdminWorkspaceSubject('/admin/problem-types', workspaceSubject)}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">문제 유형 테스트</h1>
            <p className="text-sm text-gray-500 mt-1">
              {problemType.type_name} · {problemType.provider} / {problemType.model_name}
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>테스트용 지문</CardTitle>
          <CardDescription>직접 입력하거나 기존 등록 지문 불러오기를 사용하세요.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setSelectorOpen(true)}>
              기존 등록 지문 불러오기
            </Button>
            <span className="text-sm text-muted-foreground self-center">또는 아래에 직접 입력</span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="passage">직접 입력</Label>
            <Textarea
              id="passage"
              value={passage}
              onChange={(event) => setPassage(event.target.value)}
              className="min-h-[220px]"
              placeholder="테스트할 영어 지문을 붙여넣으세요."
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>학년</Label>
              <Input value={gradeLevel} onChange={(event) => setGradeLevel(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>난이도</Label>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low">하</SelectItem>
                  <SelectItem value="Medium">중</SelectItem>
                  <SelectItem value="High">상</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>최대 반복</Label>
              <Select value={maxAttempts} onValueChange={setMaxAttempts}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1회</SelectItem>
                  <SelectItem value="2">2회</SelectItem>
                  <SelectItem value="3">3회</SelectItem>
                  <SelectItem value="4">4회</SelectItem>
                  <SelectItem value="5">5회</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={handleRunTest} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            {testing ? '테스트 실행 중...' : '테스트 실행'}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>테스트 결과</CardTitle>
            <CardDescription>
              상태: {result.status} · 중단 사유: {result.stopReason || '-'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.finalReview && (
              <div className="rounded border p-4 text-sm">
                <p className="font-medium">검토 결과: {result.finalReview.passed ? '통과' : '미통과'}</p>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{result.finalReview.feedback}</p>
              </div>
            )}
            {previewQuestion && <QuestionPreview question={previewQuestion} showSaveButton={false} />}
          </CardContent>
        </Card>
      )}

      {result?.attempts && (
        <Card>
          <CardHeader>
            <CardTitle>회차별 진행 기록</CardTitle>
            <CardDescription>API 요청·응답·검토·피드백·재생성 결과를 시간순으로 확인합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(groupedLogs).map(([attemptNo, logs]) => (
              <div key={attemptNo} className="rounded-lg border p-4">
                <h3 className="font-semibold mb-3">{attemptNo}회차</h3>
                <div className="space-y-3">
                  {logs.map((log) => (
                    <details key={log.id} className="rounded border bg-muted/20 p-3" open={log.status === 'failed'}>
                      <summary className="cursor-pointer font-medium">
                        {LOG_EVENT_LABELS[log.event]} · {log.status} · {new Date(log.timestamp).toLocaleTimeString('ko-KR')}
                      </summary>
                      <div className="mt-3 space-y-2 text-sm">
                        {log.durationMs !== undefined && <p>소요 시간: {log.durationMs}ms</p>}
                        {log.rawText && (
                          <pre className="max-h-96 overflow-auto rounded bg-white p-3 text-xs whitespace-pre-wrap">
                            {log.rawText}
                          </pre>
                        )}
                        {log.payload !== undefined && (
                          <pre className="max-h-96 overflow-auto rounded bg-white p-3 text-xs whitespace-pre-wrap">
                            {JSON.stringify(log.payload, null, 2)}
                          </pre>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <PassageSelectorModal
        open={selectorOpen}
        onOpenChange={setSelectorOpen}
        onSelect={handleSelectPassage}
      />
    </div>
  )
}
