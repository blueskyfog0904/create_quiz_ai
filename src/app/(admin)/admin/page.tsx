import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Database, Users, FileText, Settings } from 'lucide-react'
import Link from 'next/link'

export default function AdminDashboardPage() {
  const quickLinks = [
    {
      title: 'AI 문제 유형 관리',
      description: 'AI 문제 생성 유형 및 프롬프트 관리',
      href: '/admin/problem-types',
      icon: Settings,
      color: 'bg-blue-500'
    },
    {
      title: '문제은행 관리',
      description: '등록된 문제 관리 및 수정',
      href: '/admin/questions',
      icon: Database,
      color: 'bg-green-500'
    },
    {
      title: '영어지문 관리',
      description: '영어 지문 및 AI 분석 설정',
      href: '/admin/passages',
      icon: FileText,
      color: 'bg-purple-500'
    },
    {
      title: '사용자 관리',
      description: '회원 정보 및 권한 관리',
      href: '/admin/users',
      icon: Users,
      color: 'bg-orange-500'
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">관리자 대시보드</h1>
        <p className="text-gray-500 mt-1">AI영어문제팩토리 관리 시스템</p>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {quickLinks.map((link) => {
          const Icon = link.icon
          return (
            <Link key={link.href} href={link.href}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                <CardHeader className="pb-2">
                  <div className={`w-10 h-10 rounded-lg ${link.color} flex items-center justify-center mb-2`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <CardTitle className="text-lg">{link.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>{link.description}</CardDescription>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      {/* Placeholder for stats or recent activity */}
      <Card>
        <CardHeader>
          <CardTitle>시스템 현황</CardTitle>
          <CardDescription>관리 시스템 요약 정보</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">좌측 메뉴에서 관리할 항목을 선택하세요.</p>
        </CardContent>
      </Card>
    </div>
  )
}
