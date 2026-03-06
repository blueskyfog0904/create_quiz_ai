'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, Loader2, User, Check, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

interface Profile {
  id: string
  email: string | null
  name: string | null
  credit_balance?: number
}

interface GrantCreditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialUser?: Profile | null
  onSuccess?: () => void
}

export function GrantCreditDialog({ open, onOpenChange, initialUser, onSuccess }: GrantCreditDialogProps) {
  const [step, setStep] = useState<'search' | 'details' | 'confirm'>('search')
  const [selectedUser, setSelectedUser] = useState<Profile | null>(initialUser || null)
  
  // Search State
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Profile[]>([])
  const [isSearching, setIsSearching] = useState(false)
  
  // Grant details State
  const [amount, setAmount] = useState<number>(0)
  const [category, setCategory] = useState<string>('compensation')
  const [reason, setReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    if (initialUser) {
      setSelectedUser(initialUser)
      setStep('details')
    } else {
      setStep('search')
      setSelectedUser(null)
    }
    // Reset form
    setAmount(0)
    setCategory('compensation')
    setReason('')
  }, [open, initialUser])

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setIsSearching(true)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, name')
        .or(`email.ilike.%${searchQuery}%,name.ilike.%${searchQuery}%`)
        .limit(5)
      
      if (error) throw error
      setSearchResults(data || [])
    } catch (error) {
      console.error(error)
      toast.error('사용자 검색 중 오류가 발생했습니다.')
    } finally {
      setIsSearching(false)
    }
  }

  const handleUserSelect = (user: Profile) => {
    setSelectedUser(user)
    setStep('details')
  }

  const handleToConfirm = () => {
    if (!selectedUser) return
    if (amount <= 0) {
      toast.error('지급할 크레딧을 입력해주세요.')
      return
    }
    if (amount > 10000) {
      toast.error('한 번에 최대 10,000 크레딧까지만 지급할 수 있습니다.')
      return
    }
    if (!reason.trim()) {
      toast.error('지급 사유를 입력해주세요.')
      return
    }
    setStep('confirm')
  }

  const handleSubmit = async () => {
    if (!selectedUser) return
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/admin/users/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          amount,
          description: reason,
          category
        })
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '지급 실패')

      toast.success(`${selectedUser.name}님에게 크레딧이 지급되었습니다.`)
      onSuccess?.()
      onOpenChange(false)
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>크레딧 수동 지급</DialogTitle>
          <DialogDescription>
            사용자에게 크레딧을 지급하고 알림을 발송합니다.
          </DialogDescription>
        </DialogHeader>

        {step === 'search' && (
          <div className="space-y-4 py-4">
            <div className="flex gap-2">
              <Input 
                placeholder="이름 또는 이메일 검색..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <Button onClick={handleSearch} disabled={isSearching}>
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {searchResults.map(user => (
                <div 
                  key={user.id} 
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => handleUserSelect(user)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                      <User className="h-4 w-4 text-gray-500" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">{user.name || '이름 없음'}</div>
                      <div className="text-xs text-gray-500">{user.email}</div>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm">선택</Button>
                </div>
              ))}
              {searchResults.length === 0 && searchQuery && !isSearching && (
                <div className="text-center text-sm text-gray-500 py-4">검색 결과가 없습니다.</div>
              )}
            </div>
          </div>
        )}

        {step === 'details' && selectedUser && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3 p-3 bg-blue-50 text-blue-900 rounded-lg text-sm">
              <User className="h-4 w-4" />
              <span className="font-semibold">{selectedUser.name}</span>
              <span className="text-blue-700">({selectedUser.email})</span>
              <Button variant="ghost" className="ml-auto h-6 text-xs hover:bg-blue-100" onClick={() => setStep('search')}>변경</Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>지급 금액</Label>
                <div className="relative">
                  <Input 
                    type="number" 
                    value={amount} 
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="pr-12"
                    placeholder="0"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">Credit</span>
                </div>
                {amount > 10000 && (
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    최대 10,000 크레딧까지만 가능합니다.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>사유 카테고리</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="compensation">보상 (장애/오류)</SelectItem>
                    <SelectItem value="event">이벤트 당첨</SelectItem>
                    <SelectItem value="refund">환불 (취소/철회)</SelectItem>
                    <SelectItem value="other">기타</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>상세 지급 사유 <span className="text-red-500">*</span></Label>
              <Textarea 
                value={reason} 
                onChange={(e) => setReason(e.target.value)}
                placeholder="지급 사유를 구체적으로 입력해주세요 (예: 서버 장애 보상)"
                className="h-20"
              />
            </div>
          </div>
        )}

        {step === 'confirm' && selectedUser && (
            <div className="space-y-6 py-4">
                <div className="text-center space-y-2">
                    <h3 className="text-lg font-bold text-gray-900">지급 내용을 확인해주세요</h3>
                    <p className="text-sm text-gray-500">지급 후에는 취소할 수 없으며 사용자에게 알림이 발송됩니다.</p>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg space-y-3 text-sm">
                    <div className="flex justify-between">
                        <span className="text-gray-500">받는 사람</span>
                        <span className="font-medium">{selectedUser.name} ({selectedUser.email})</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500">지급 금액</span>
                        <span className="font-bold text-blue-600">+{amount.toLocaleString()} Credit</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500">카테고리</span>
                        <span className="font-medium">
                            {category === 'compensation' ? '보상' : 
                             category === 'event' ? '이벤트' : 
                             category === 'refund' ? '환불' : '기타'}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500">상세 사유</span>
                        <span className="font-medium text-right max-w-[200px] break-words">{reason}</span>
                    </div>
                </div>
            </div>
        )}

        <DialogFooter className="justify-center gap-2">
            {step === 'details' && (
                <>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
                    <Button onClick={handleToConfirm}>다음</Button>
                </>
            )}
            {step === 'confirm' && (
                <>
                    <Button variant="outline" onClick={() => setStep('details')}>이전</Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700">
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                        지급 확정
                    </Button>
                </>
            )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
