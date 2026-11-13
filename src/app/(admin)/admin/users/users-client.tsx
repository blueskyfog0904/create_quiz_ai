'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
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
  Coins,
  Plus
} from 'lucide-react'
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
import { updateListQuery } from '@/lib/list-pagination'
import { formatMemberDisplayName } from '@/lib/member-display-name'
import type { AdminUserListItem } from '@/lib/admin-users-server'
import { GrantCreditDialog } from '../credits/grant-credit-dialog'

interface UsersClientProps {
  users: AdminUserListItem[]
  totalCount: number
  page: number
  pageSize: number
  query: string
}

// 목록·검색·페이지는 서버가 정한다(주소의 q·page·pageSize). 이 화면은 받은 값을 그대로 그린다.
export function UsersClient({ users, totalCount, page, pageSize, query }: UsersClientProps) {
  const router = useRouter()
  const [search, setSearch] = useState(query)
  // 지급 창에는 대상 회원의 식별 정보만 넘긴다(창은 이 값이 바뀔 때 입력을 초기화하므로 같은 객체를 유지한다).
  const [selectedUser, setSelectedUser] = useState<Pick<AdminUserListItem, 'id' | 'email' | 'display_tag'> | null>(null)
  const [isGrantDialogOpen, setIsGrantDialogOpen] = useState(false)

  const buildHref = (changes: Record<string, string | number | null>) => {
    const next = updateListQuery(new URLSearchParams({
      ...(query ? { q: query } : {}),
      page: String(page),
      pageSize: String(pageSize),
    }).toString(), changes)
    return next ? `/admin/users?${next}` : '/admin/users'
  }

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    router.push(buildHref({ q: search.trim() || null, page: 1 }))
  }

  const openGrantDialog = (user: AdminUserListItem) => {
    setSelectedUser({ id: user.id, email: user.email, display_tag: user.display_tag })
    setIsGrantDialogOpen(true)
  }

  return (
    <div className="space-y-6">
      <GrantCreditDialog
        open={isGrantDialogOpen}
        onOpenChange={setIsGrantDialogOpen}
        initialUser={selectedUser}
        onSuccess={() => router.refresh()}
      />

      {/* Search */}
      <div className="flex gap-4 items-center">
        <form onSubmit={handleSearch} className="flex flex-1 max-w-md gap-2" role="search">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="이메일, 전화번호, 소속으로 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
              aria-label="사용자 검색"
            />
          </div>
          <Button type="submit" variant="outline">검색</Button>
        </form>
        <Badge variant="secondary" className="text-sm">
          {query ? `검색 결과 ${totalCount.toLocaleString()}명` : `총 ${totalCount.toLocaleString()}명`}
        </Badge>
      </div>

      {/* Users List */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {users.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              {query ? '검색 결과가 없습니다.' : '가입한 사용자가 없습니다.'}
            </div>
          ) : (
            <div className="divide-y">
              {users.map((user) => (
                <div key={user.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                        <User className="h-5 w-5 text-gray-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">
                            {formatMemberDisplayName(user.email, user.display_tag)}
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
                        <div className="flex items-center gap-4 mt-2">
                          <div className="flex items-center gap-1 text-xs text-gray-400">
                            <Calendar className="h-3 w-3" />
                            가입일: {new Date(user.created_at).toLocaleDateString('ko-KR')}
                          </div>
                          {/* Credit Display */}
                          <div className="flex items-center gap-1 text-sm font-semibold text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded">
                            <Coins className="h-3 w-3" />
                            {user.credit_balance === null ? '잔액 확인 불가' : `${user.credit_balance.toLocaleString()} C`}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {user.role && (
                        <Badge variant="secondary">
                          {user.role === 'teacher' ? '교사' :
                            user.role === 'instructor' ? '강사' :
                              user.role === 'student' ? '학생' :
                                user.role === 'parent' ? '학부모' :
                                  user.role === 'academy_instructor' ? '학원강사' :
                                    user.role}
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1"
                        onClick={() => openGrantDialog(user)}
                      >
                        <Plus className="h-3 w-3" />
                        크레딧 지급
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <StudioListPagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={(nextPage) => router.push(buildHref({ page: nextPage }))}
        onPageSizeChange={(nextSize) => router.push(buildHref({ pageSize: nextSize, page: 1 }))}
        getPageHref={(nextPage) => buildHref({ page: nextPage })}
      />
    </div>
  )
}
