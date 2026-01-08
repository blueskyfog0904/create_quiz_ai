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
import { Loader2, MessageCircle, Clock, CheckCircle, AlertCircle } from 'lucide-react'
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
      <Card>
        <CardHeader>
          <CardTitle>문의 내역</CardTitle>
          <CardDescription>
            이전에 등록한 문의 내역입니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tickets.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <MessageCircle className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <p>아직 문의 내역이 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {tickets.map((ticket) => (
                <div key={ticket.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-medium">{ticket.subject}</h4>
                    {getStatusBadge(ticket.status)}
                  </div>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap mb-3">
                    {ticket.message}
                  </p>
                  <p className="text-xs text-gray-400">
                    {new Date(ticket.created_at).toLocaleDateString('ko-KR', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                  
                  {ticket.admin_response && (
                    <div className="mt-4 p-3 bg-blue-50 rounded-lg border-l-4 border-blue-500">
                      <p className="text-sm font-medium text-blue-900 mb-1">관리자 답변</p>
                      <p className="text-sm text-blue-800 whitespace-pre-wrap">
                        {ticket.admin_response}
                      </p>
                      {ticket.responded_at && (
                        <p className="text-xs text-blue-600 mt-2">
                          {new Date(ticket.responded_at).toLocaleDateString('ko-KR', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </p>
                      )}
                    </div>
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


