'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Search,
  User,
  Mail,
  Phone,
  Calendar,
  Shield,
  ChevronLeft,
  ChevronRight,
  Coins,
  Plus
} from 'lucide-react'
import { toast } from 'sonner'

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
  credit_balance?: number
}

interface UsersClientProps {
  initialUsers: Profile[]
  totalCount: number
}

export function UsersClient({ initialUsers, totalCount }: UsersClientProps) {
  const [users, setUsers] = useState<Profile[]>(initialUsers)
  const [search, setSearch] = useState('')
  
  // Grant Credit Logic
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null)
  const [isGrantModalOpen, setIsGrantModalOpen] = useState(false)
  const [grantAmount, setGrantAmount] = useState<number>(0)
  const [grantReason, setGrantReason] = useState('')
  const [isGranting, setIsGranting] = useState(false)

  const filteredUsers = users.filter((user) => {
    const searchLower = search.toLowerCase()
    return (
      user.email?.toLowerCase().includes(searchLower) ||
      user.name?.toLowerCase().includes(searchLower) ||
      user.phone?.includes(search) ||
      user.organization?.toLowerCase().includes(searchLower)
    )
  })

  const openGrantModal = (user: Profile) => {
    setSelectedUser(user)
    setGrantAmount(0)
    setGrantReason('')
    setIsGrantModalOpen(true)
  }

  const handleGrantCredit = async () => {
    if (!selectedUser || grantAmount <= 0) return

    setIsGranting(true)
    try {
      const response = await fetch('/api/admin/users/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          amount: grantAmount,
          description: grantReason || '관리자 수동 지급'
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to grant credits')
      }

      // Update local state
      setUsers(users.map(u => 
        u.id === selectedUser.id 
          ? { ...u, credit_balance: data.newBalance } 
          : u
      ))

      toast.success('크레딧이 지급되었습니다.')
      setIsGrantModalOpen(false)
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsGranting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Grant Credit Modal */}
      <Dialog open={isGrantModalOpen} onOpenChange={setIsGrantModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>크레딧 지급</DialogTitle>
            <DialogDescription>
              {selectedUser?.name} ({selectedUser?.email}) 님에게 크레딧을 지급합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>지급할 크레딧</Label>
              <Input 
                type="number" 
                value={grantAmount} 
                onChange={(e) => setGrantAmount(Number(e.target.value))}
                placeholder="1000"
              />
            </div>
            <div className="space-y-2">
              <Label>지급 사유</Label>
              <Textarea 
                value={grantReason}
                onChange={(e) => setGrantReason(e.target.value)}
                placeholder="예: 이벤트 당첨, 시스템 환불 등"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsGrantModalOpen(false)}>취소</Button>
            <Button onClick={handleGrantCredit} disabled={isGranting || grantAmount <= 0}>
              {isGranting ? '지급 중...' : '지급하기'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                        <div className="flex items-center gap-4 mt-2">
                            <div className="flex items-center gap-1 text-xs text-gray-400">
                                <Calendar className="h-3 w-3" />
                                가입일: {new Date(user.created_at).toLocaleDateString('ko-KR')}
                            </div>
                            {/* Credit Display */}
                            <div className="flex items-center gap-1 text-sm font-semibold text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded">
                                <Coins className="h-3 w-3" />
                                {user.credit_balance?.toLocaleString() || 0} C
                            </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {user.role && (
                        <Badge variant="secondary">
                          {user.role === 'teacher' ? '선생님' : user.role === 'academy_instructor' ? '학원강사' : user.role}
                        </Badge>
                      )}
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="h-8 gap-1"
                        onClick={() => openGrantModal(user)}
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

