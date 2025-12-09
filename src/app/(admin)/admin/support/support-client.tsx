'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  MessageSquare,
  Clock,
  CheckCircle,
  AlertCircle,
  Send,
} from 'lucide-react'

interface Ticket {
  id: string
  user_id: string
  subject: string
  message: string
  status: string | null
  admin_response: string | null
  responded_at: string | null
  created_at: string
  updated_at: string
  profiles: {
    name: string | null
    email: string | null
  } | null
}

interface SupportClientProps {
  initialTickets: Ticket[]
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: '대기 중', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  in_progress: { label: '처리 중', color: 'bg-blue-100 text-blue-700', icon: MessageSquare },
  resolved: { label: '해결됨', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  closed: { label: '종료', color: 'bg-gray-100 text-gray-700', icon: AlertCircle },
}

export function SupportClient({ initialTickets }: SupportClientProps) {
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets)
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [response, setResponse] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleRespond = async () => {
    if (!selectedTicket || !response.trim()) return

    try {
      setSubmitting(true)
      
      const res = await fetch('/api/support', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: selectedTicket.id,
          adminResponse: response,
          status: 'resolved',
        }),
      })

      if (!res.ok) throw new Error('Failed to respond')

      // Update local state
      setTickets(tickets.map(t => 
        t.id === selectedTicket.id 
          ? { ...t, admin_response: response, status: 'resolved', responded_at: new Date().toISOString() }
          : t
      ))

      setSelectedTicket(null)
      setResponse('')
      alert('답변이 등록되었습니다.')
    } catch (error) {
      console.error(error)
      alert('답변 등록에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  const pendingCount = tickets.filter(t => t.status === 'pending').length
  const resolvedCount = tickets.filter(t => t.status === 'resolved').length

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">대기 중</p>
                <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">해결됨</p>
                <p className="text-2xl font-bold text-green-600">{resolvedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <MessageSquare className="h-5 w-5 text-gray-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">전체</p>
                <p className="text-2xl font-bold">{tickets.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tickets List */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">문의 목록</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {tickets.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              등록된 문의가 없습니다.
            </div>
          ) : (
            <div className="divide-y">
              {tickets.map((ticket) => {
                const status = statusConfig[ticket.status || 'pending']
                const StatusIcon = status.icon

                return (
                  <div
                    key={ticket.id}
                    className="p-4 hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => setSelectedTicket(ticket)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">
                            {ticket.subject}
                          </span>
                          <Badge className={status.color}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {status.label}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-500 mt-1 line-clamp-1">
                          {ticket.message}
                        </p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                          <span>
                            {ticket.profiles?.name || ticket.profiles?.email || '알 수 없음'}
                          </span>
                          <span>•</span>
                          <span>
                            {new Date(ticket.created_at).toLocaleDateString('ko-KR')}
                          </span>
                          {ticket.responded_at && (
                            <>
                              <span>•</span>
                              <span className="text-green-600">
                                답변완료: {new Date(ticket.responded_at).toLocaleDateString('ko-KR')}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ticket Detail Dialog */}
      <Dialog open={!!selectedTicket} onOpenChange={() => setSelectedTicket(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedTicket?.subject}</DialogTitle>
            <DialogDescription>
              {selectedTicket?.profiles?.name || selectedTicket?.profiles?.email} •{' '}
              {selectedTicket && new Date(selectedTicket.created_at).toLocaleString('ko-KR')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm font-medium text-gray-700 mb-2">문의 내용</p>
              <p className="text-gray-600 whitespace-pre-wrap">{selectedTicket?.message}</p>
            </div>

            {selectedTicket?.admin_response && (
              <div className="p-4 bg-green-50 rounded-lg">
                <p className="text-sm font-medium text-green-700 mb-2">관리자 답변</p>
                <p className="text-gray-600 whitespace-pre-wrap">{selectedTicket.admin_response}</p>
              </div>
            )}

            {selectedTicket?.status === 'pending' && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">답변 작성</p>
                <Textarea
                  placeholder="답변을 입력하세요..."
                  rows={4}
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedTicket(null)}>
              닫기
            </Button>
            {selectedTicket?.status === 'pending' && (
              <Button onClick={handleRespond} disabled={submitting || !response.trim()}>
                <Send className="h-4 w-4 mr-2" />
                {submitting ? '전송 중...' : '답변 등록'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

