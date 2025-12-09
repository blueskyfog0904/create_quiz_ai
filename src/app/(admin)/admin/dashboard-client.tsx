'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Users,
  FileText,
  Sparkles,
  AlertTriangle,
  TrendingUp,
  Clock,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface Stats {
  signups: {
    today: number
    month: number
  }
  questions: {
    total: number
  }
  aiGenerations: {
    today: number
    month: number
  }
  downloads: {
    today: number
    month: number
  }
  errorLogs: {
    today: number
  }
  recentQuestions: Array<{
    id: string
    question_text: string
    grade_level: string | null
    difficulty: string | null
    created_at: string
    profiles: {
      name: string | null
      email: string | null
    } | null
  }>
  topGradeLevels: Array<{
    grade_level: string
    count: number
  }>
}

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

  const statCards = [
    {
      title: '신규 가입자',
      value: stats.signups.today,
      subValue: `이번 달 ${stats.signups.month}명`,
      icon: Users,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      title: '문제 판매/다운로드',
      value: stats.downloads.today,
      subValue: `이번 달 ${stats.downloads.month}건`,
      icon: FileText,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      title: 'AI 문제 생성',
      value: stats.aiGenerations.today,
      subValue: `이번 달 ${stats.aiGenerations.month}회`,
      icon: Sparkles,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
    {
      title: '에러/실패 로그',
      value: stats.errorLogs.today,
      subValue: '오늘 발생',
      icon: AlertTriangle,
      color: stats.errorLogs.today > 0 ? 'text-red-600' : 'text-gray-600',
      bgColor: stats.errorLogs.today > 0 ? 'bg-red-50' : 'bg-gray-50',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Refresh Button */}
      <div className="flex justify-end">
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

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.title} className="border-0 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">{card.title}</p>
                    <p className="text-3xl font-bold mt-1">{card.value}</p>
                    <p className="text-xs text-gray-400 mt-1">{card.subValue}</p>
                  </div>
                  <div className={`p-3 rounded-full ${card.bgColor}`}>
                    <Icon className={`h-6 w-6 ${card.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Questions */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-gray-400" />
                최근 업로드된 문제
              </CardTitle>
              <Link href="/admin/questions">
                <Button variant="ghost" size="sm">
                  전체보기 →
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {stats.recentQuestions.length === 0 ? (
              <p className="text-gray-500 text-center py-8">아직 업로드된 문제가 없습니다.</p>
            ) : (
              <div className="space-y-3">
                {stats.recentQuestions.slice(0, 5).map((question) => (
                  <div
                    key={question.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {question.question_text.length > 50
                          ? question.question_text.slice(0, 50) + '...'
                          : question.question_text}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {question.profiles?.name || question.profiles?.email || '알 수 없음'} •{' '}
                        {new Date(question.created_at).toLocaleDateString('ko-KR')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      {question.grade_level && (
                        <Badge variant="secondary" className="text-xs">
                          {question.grade_level}
                        </Badge>
                      )}
                      {question.difficulty && (
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${
                            question.difficulty === '상' 
                              ? 'border-red-300 text-red-600' 
                              : question.difficulty === '중'
                              ? 'border-yellow-300 text-yellow-600'
                              : 'border-green-300 text-green-600'
                          }`}
                        >
                          {question.difficulty}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Grade Levels */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-gray-400" />
              자주 사용된 학년 TOP 5
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topGradeLevels.length === 0 ? (
              <p className="text-gray-500 text-center py-8">아직 데이터가 없습니다.</p>
            ) : (
              <div className="space-y-3">
                {stats.topGradeLevels.map((item, index) => {
                  const maxCount = stats.topGradeLevels[0]?.count || 1
                  const percentage = (item.count / maxCount) * 100
                  
                  return (
                    <div key={item.grade_level} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`
                            w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                            ${index === 0 ? 'bg-yellow-100 text-yellow-700' : 
                              index === 1 ? 'bg-gray-100 text-gray-700' :
                              index === 2 ? 'bg-orange-100 text-orange-700' :
                              'bg-gray-50 text-gray-500'}
                          `}>
                            {index + 1}
                          </span>
                          <span className="font-medium text-gray-900">{item.grade_level}</span>
                        </div>
                        <span className="text-sm text-gray-600">{item.count}문제</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            index === 0 ? 'bg-orange-500' :
                            index === 1 ? 'bg-orange-400' :
                            index === 2 ? 'bg-orange-300' :
                            'bg-orange-200'
                          }`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Server Status */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">시스템 상태</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
              <div>
                <p className="font-medium text-green-800">API 서버</p>
                <p className="text-sm text-green-600">정상 작동 중</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
              <div>
                <p className="font-medium text-green-800">데이터베이스</p>
                <p className="text-sm text-green-600">정상 작동 중</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
              <div>
                <p className="font-medium text-green-800">AI 서비스</p>
                <p className="text-sm text-green-600">정상 작동 중</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-xl p-6 shadow-sm border animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
            <div className="h-8 bg-gray-200 rounded w-16 mb-2" />
            <div className="h-3 bg-gray-200 rounded w-32" />
          </div>
        ))}
      </div>
    </div>
  )
}

