'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ClipboardList, RefreshCw, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { AdminWorkSummary } from '@/lib/admin-work-summary-server'

interface Stats {
  signups: { today: number | null; month: number | null }
  work: AdminWorkSummary
  period: { year: number; month: number }
}

// 처리 대기 항목: 어떤 숫자를, 어떤 이름으로, 어느 화면에서 처리하는지
const WORK_ITEMS: Array<{ key: keyof AdminWorkSummary; label: string; href: string }> = [
  { key: 'paymentAlertOpen', label: '미해소 결제 경보', href: '/admin/refunds' },
  { key: 'paymentOrderReview', label: '수동 확인이 필요한 결제 주문', href: '/admin/refunds' },
  { key: 'refundAttention', label: '충전 환불 — 재처리·수동 확인', href: '/admin/refunds' },
  { key: 'refundPending', label: '충전 환불 — 승인 대기', href: '/admin/refunds' },
  { key: 'marketRefundPending', label: '문제마켓 환불 대기', href: '/admin/refunds' },
  { key: 'supportPending', label: '답변 대기 문의', href: '/admin/support' },
]

// 세지 못한 값(null)은 0으로 보이지 않게 따로 표시한다.
const formatCount = (value: number | null) => (value === null ? '확인 불가' : value.toLocaleString())

export function DashboardClient() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/stats')
      if (!response.ok) throw new Error('Failed to fetch stats')
      const data = await response.json()
      setStats(data)
      setError(null)
    } catch (err) {
      setError('통계를 불러오는데 실패했습니다.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStats()
  }, [])

  if (loading) {
    return <DashboardSkeleton />
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <p className="text-gray-600">{error}</p>
        <Button onClick={fetchStats} className="mt-4">
          다시 시도
        </Button>
      </div>
    )
  }

  if (!stats) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">기준: 한국 시간</p>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchStats}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-gray-400" aria-hidden="true" />
              처리 대기
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {WORK_ITEMS.map((item) => {
                const value = stats.work[item.key]
                // 0이 아니면(확인 불가 포함) 눈에 띄게 한다.
                const needsAttention = value !== 0
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      className="flex items-center justify-between gap-4 py-3 hover:bg-gray-50"
                    >
                      <span className={needsAttention ? 'font-semibold text-gray-900' : 'text-gray-600'}>
                        {item.label}
                      </span>
                      <span
                        className={
                          needsAttention
                            ? 'rounded-full bg-red-100 px-3 py-0.5 text-sm font-bold text-red-700'
                            : 'px-3 text-sm text-gray-400'
                        }
                      >
                        {formatCount(value)}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">오늘 신규 가입자</p>
                <p className="text-3xl font-bold mt-1">{formatCount(stats.signups.today)}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {stats.period.year}년 {stats.period.month}월 {formatCount(stats.signups.month)}
                  {stats.signups.month === null ? '' : '명'}
                </p>
              </div>
              <div className="p-3 rounded-full bg-blue-50">
                <Users className="h-6 w-6 text-blue-600" aria-hidden="true" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {[1, 2].map((i) => (
          <div key={i} className={`bg-white rounded-xl p-6 shadow-sm border animate-pulse ${i === 1 ? 'lg:col-span-2' : ''}`}>
            <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
            <div className="h-8 bg-gray-200 rounded w-16 mb-2" />
            <div className="h-3 bg-gray-200 rounded w-32" />
          </div>
        ))}
      </div>
    </div>
  )
}
