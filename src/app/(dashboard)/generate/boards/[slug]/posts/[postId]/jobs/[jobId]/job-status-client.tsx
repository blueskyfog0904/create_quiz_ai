'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { Database } from '@/types/supabase'

type GenerateMenuEntry = Database['public']['Tables']['generate_menu_entries']['Row']
type GenerateListboardPost = Database['public']['Tables']['generate_listboard_posts']['Row']
type GenerateListboardGenerationJob = Database['public']['Tables']['generate_listboard_generation_jobs']['Row']
type GenerateListboardGenerationJobItem = Database['public']['Tables']['generate_listboard_generation_job_items']['Row']

interface JobStatusItem extends GenerateListboardGenerationJobItem {
  question_number: string
  problem_type_name: string
}

interface JobStatusClientProps {
  board: GenerateMenuEntry
  post: GenerateListboardPost
  initialJob: GenerateListboardGenerationJob
  initialItems: JobStatusItem[]
}

export default function JobStatusClient({
  board,
  post,
  initialJob,
  initialItems,
}: JobStatusClientProps) {
  const router = useRouter()
  const [job, setJob] = useState(initialJob)
  const [items, setItems] = useState(initialItems)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const refreshJob = useCallback(async (silent = false) => {
    if (!silent) {
      setIsRefreshing(true)
    }

    try {
      const res = await fetch(`/api/generate/listboard-jobs/${job.id}`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || '작업 상태를 불러오지 못했습니다.')
      }

      setJob(data.data.job)
      setItems(data.data.items)
    } catch (error) {
      if (!silent) {
        toast.error(error instanceof Error ? error.message : '작업 상태 조회 중 오류가 발생했습니다.')
      }
    } finally {
      setIsRefreshing(false)
    }
  }, [job.id])

  useEffect(() => {
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'partially_completed') {
      return
    }

    const interval = window.setInterval(() => {
      void refreshJob(true)
    }, 5000)

    return () => window.clearInterval(interval)
  }, [job.status, refreshJob])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">배치 생성 작업</h1>
          <p className="mt-2 text-gray-500">{post.title} 게시글 기준 작업 상태를 확인할 수 있습니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void refreshJob()} disabled={isRefreshing}>
            {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            새로고침
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/generate/boards/${board.slug}/posts/${post.id}`}>선택 화면으로 돌아가기</Link>
          </Button>
          <Button onClick={() => router.push('/bank')}>문제은행으로 이동</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>작업 요약</CardTitle>
          <CardDescription>문항 번호와 문제 유형 조합별 실제 생성 결과를 확인할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-gray-700 md:grid-cols-5">
          <div className="rounded-md border bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-500">상태</p>
            <p className="mt-1 text-lg font-semibold">{job.status}</p>
          </div>
          <div className="rounded-md border bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-500">요청 문항 수</p>
            <p className="mt-1 text-lg font-semibold">{job.requested_item_count}</p>
          </div>
          <div className="rounded-md border bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-500">요청 문제유형 수</p>
            <p className="mt-1 text-lg font-semibold">{job.requested_type_count}</p>
          </div>
          <div className="rounded-md border bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-500">총 생성 건수</p>
            <p className="mt-1 text-lg font-semibold">{job.requested_generation_count}</p>
          </div>
          <div className="rounded-md border bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-500">예상 차감 크레딧</p>
            <p className="mt-1 text-lg font-semibold text-primary">{job.credit_reserved.toLocaleString()}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>작업 항목</CardTitle>
          <CardDescription>문항 번호와 문제 유형 조합별 작업 상태입니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-gray-900">{item.question_number}번 · {item.problem_type_name}</p>
                  {item.error_message ? <p className="mt-1 text-red-600">{item.error_message}</p> : null}
                </div>
                <div className="text-right">
                  <p className="font-medium">{item.status}</p>
                  <p className="text-xs text-gray-500">시도 횟수 {item.attempt_count}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
