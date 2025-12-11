'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Search,
  User,
  Mail,
  Phone,
  Calendar,
  Shield,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

interface Profile {
  id: string
  email: string | null
  name: string | null
  phone: string | null
  organization: string | null
  role: string | null
  is_admin: boolean | null
  provider: string | null
  created_at: string
  updated_at: string
}

interface UsersClientProps {
  initialUsers: Profile[]
  totalCount: number
}

export function UsersClient({ initialUsers, totalCount }: UsersClientProps) {
  const [users] = useState<Profile[]>(initialUsers)
  const [search, setSearch] = useState('')

  const filteredUsers = users.filter((user) => {
    const searchLower = search.toLowerCase()
    return (
      user.email?.toLowerCase().includes(searchLower) ||
      user.name?.toLowerCase().includes(searchLower) ||
      user.phone?.includes(search) ||
      user.organization?.toLowerCase().includes(searchLower)
    )
  })

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="flex gap-4 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="이름, 이메일, 전화번호로 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Badge variant="secondary" className="text-sm">
          총 {totalCount}명
        </Badge>
      </div>

      {/* Users List */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {filteredUsers.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              검색 결과가 없습니다.
            </div>
          ) : (
            <div className="divide-y">
              {filteredUsers.map((user) => (
                <div key={user.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                        <User className="h-5 w-5 text-gray-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">
                            {user.name || '이름 없음'}
                          </span>
                          {user.is_admin && (
                            <Badge className="bg-orange-100 text-orange-700">
                              <Shield className="h-3 w-3 mr-1" />
                              관리자
                            </Badge>
                          )}
                          {user.provider && (
                            <Badge variant="outline" className="text-xs">
                              {user.provider}
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-4 mt-1 text-sm text-gray-500">
                          {user.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {user.email}
                            </span>
                          )}
                          {user.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {user.phone}
                            </span>
                          )}
                          {user.organization && (
                            <span className="text-blue-600">{user.organization}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                          <Calendar className="h-3 w-3" />
                          가입일: {new Date(user.created_at).toLocaleDateString('ko-KR')}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {user.role && (
                        <Badge variant="secondary">
                          {user.role === 'teacher' ? '선생님' : user.role === 'academy_instructor' ? '학원강사' : user.role}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination (placeholder) */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {filteredUsers.length}명 표시 중
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft className="h-4 w-4" />
            이전
          </Button>
          <span className="text-sm text-gray-600 px-2">1 / 1</span>
          <Button variant="outline" size="sm" disabled>
            다음
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

