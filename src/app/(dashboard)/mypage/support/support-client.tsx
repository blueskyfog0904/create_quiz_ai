'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Loader2, MessageCircle, Clock, CheckCircle, AlertCircle, Trash2, Pencil } from 'lucide-react'
import { Database } from '@/types/supabase'

type SupportTicket = Database['public']['Tables']['support_tickets']['Row']

interface SupportClientProps {
  tickets: SupportTicket[]
  userId: string
}

export function SupportClient({ tickets, userId }: SupportClientProps) {
  const router = useRouter()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />대기중</Badge>
      case 'in_progress':
        return <Badge variant="default"><AlertCircle className="h-3 w-3 mr-1" />처리중</Badge>
      case 'resolved':
        return <Badge variant="outline" className="text-green-600"><CheckCircle className="h-3 w-3 mr-1" />답변완료</Badge>
      case 'closed':
        return <Badge variant="outline">종료</Badge>
      default:
        return <Badge variant="secondary">대기중</Badge>
    }
  }


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!subject.trim() || !message.trim()) {
      toast.error('제목과 내용을 모두 입력해주세요.')
      return
    }

    setIsSubmitting(true)
    
    try {
      const response = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message })
      })

      if (!response.ok) {
        throw new Error('문의 등록에 실패했습니다.')
      }

      toast.success('문의가 등록되었습니다. 빠른 시일 내에 답변드리겠습니다.')
      setSubject('')
      setMessage('')
      router.refresh()
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (ticketId: string) => {
    if (!confirm('정말 이 문의 내역을 삭제하시겠습니까?\n삭제된 내역은 복구할 수 없습니다.')) {
      return
    }

    try {
      const response = await fetch(`/api/support?id=${ticketId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('삭제에 실패했습니다.')
      }

      toast.success('문의 내역이 삭제되었습니다.')
      router.refresh()
    } catch (error: any) {
      toast.error(error.message)
    }
  }


  const [editingId, setEditingId] = useState<string | null>(null)
  const [editSubject, setEditSubject] = useState('')
  const [editMessage, setEditMessage] = useState('')

  const startEditing = (ticket: SupportTicket) => {
    setEditingId(ticket.id)
    setEditSubject(ticket.subject)
    setEditMessage(ticket.message)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditSubject('')
    setEditMessage('')
  }

  const handleUpdate = async (ticketId: string) => {
    if (!editSubject.trim() || !editMessage.trim()) {
      toast.error('제목과 내용을 모두 입력해주세요.')
      return
    }

    try {
      const response = await fetch('/api/support', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ticketId, 
          subject: editSubject, 
          message: editMessage 
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '수정에 실패했습니다.')
      }

      toast.success('문의 내용이 수정되었습니다.')
      cancelEditing()
      router.refresh()
    } catch (error: any) {
      toast.error(error.message)
    }
  }

  return (
    <div className="space-y-6">
      {/* New Inquiry Form */}
      <Card>
        <CardHeader>
          <CardTitle>1:1 문의하기</CardTitle>
          <CardDescription>
            궁금한 점이나 문제가 있으시면 문의해주세요. 빠른 시일 내에 답변드리겠습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subject">제목</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="문의 제목을 입력해주세요"
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="message">내용</Label>
              <Textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="문의 내용을 자세히 작성해주세요"
                className="min-h-[150px]"
                required
              />
            </div>

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              문의 등록하기
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Inquiry History */}
      <Card className="border-none shadow-sm bg-white">
        <CardHeader className="px-6 pt-6 pb-4 border-b">
          <CardTitle className="text-lg font-semibold text-gray-900">문의 내역</CardTitle>
          <CardDescription className="text-gray-500">
            고객님께서 남겨주신 문의와 답변을 확인하실 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-gray-500 bg-gray-50/50">
              <div className="bg-white p-4 rounded-full shadow-sm mb-4">
                <MessageCircle className="h-8 w-8 text-gray-400" />
              </div>
              <p className="font-medium text-gray-900 mb-1">아직 문의하신 내역이 없습니다</p>
              <p className="text-sm">궁금한 점이 있으시면 언제든지 문의해주세요.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {tickets.map((ticket) => (
                <div key={ticket.id} className="p-6 hover:bg-gray-50/50 transition-colors group">
                  {editingId === ticket.id ? (
                    // Edit Mode
                    <div className="space-y-4 bg-white p-2 rounded-lg border border-orange-100 shadow-sm">
                      <div className="space-y-2">
                        <Label>제목 수정</Label>
                        <Input 
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          placeholder="제목을 입력하세요"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>내용 수정</Label>
                        <Textarea 
                          value={editMessage}
                          onChange={(e) => setEditMessage(e.target.value)}
                          placeholder="내용을 입력하세요"
                          className="min-h-[100px]"
                        />
                      </div>
                      <div className="flex justify-center gap-2">
                        <Button variant="outline" size="sm" onClick={cancelEditing}>취소</Button>
                        <Button size="sm" onClick={() => handleUpdate(ticket.id)}>수정 완료</Button>
                      </div>
                    </div>
                  ) : (
                    // View Mode
                    <>
                      {/* Question Section */}
                      <div className="flex flex-col gap-3 mb-6">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded text-[11px]">Q</span>
                              <h4 className="font-semibold text-gray-900 text-base">{ticket.subject}</h4>
                            </div>
                            <p className="text-xs text-gray-400 pl-7">
                              {new Date(ticket.created_at).toLocaleDateString('ko-KR', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {getStatusBadge(ticket.status)}
                            {/* Actions */}
                            {ticket.status === 'pending' && (
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                                  onClick={() => startEditing(ticket)}
                                  title="문의 수정"
                                >
                                  <Pencil className="h-4 w-4" />
                                  <span className="sr-only">수정</span>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-gray-400 hover:text-red-500 hover:bg-red-50"
                                  onClick={() => handleDelete(ticket.id)}
                                  title="문의 삭제"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  <span className="sr-only">삭제</span>
                                </Button>
                              </div>
                            )}
                             {/* Delete only if resolved/closed (Admin handled) - Wait, user asked to delete ANY ticket */}
                             {ticket.status !== 'pending' && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-gray-400 hover:text-red-500 hover:bg-red-50"
                                  onClick={() => handleDelete(ticket.id)}
                                  title="문의 내역 삭제"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  <span className="sr-only">삭제</span>
                                </Button>
                             )}
                          </div>
                        </div>
                        <div className="pl-7 pr-2">
                          <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                            {ticket.message}
                          </p>
                        </div>
                      </div>
                      
                      {/* Admin Response Section */}
                      {ticket.admin_response && (
                        <div className="pl-7 mt-5">
                          <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 relative group/response">
                            <div className="absolute left-0 top-6 w-1 h-8 bg-gray-800 rounded-r-full group-hover/response:bg-orange-500 transition-colors" />
                            
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-sm font-bold text-white bg-gray-900 px-2 py-0.5 rounded text-[11px] group-hover/response:bg-orange-600 transition-colors">A</span>
                              <span className="text-sm font-semibold text-gray-900">관리자 답변</span>
                              <span className="text-xs text-gray-400 ml-auto">
                                {ticket.responded_at && new Date(ticket.responded_at).toLocaleDateString('ko-KR', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric'
                                })}
                              </span>
                            </div>
                            
                            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap pl-7">
                              {ticket.admin_response}
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}


