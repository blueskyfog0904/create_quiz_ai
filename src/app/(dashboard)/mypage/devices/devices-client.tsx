'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Monitor, Smartphone, Tablet, LogOut, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Database } from '@/types/supabase'

type Session = Database['public']['Tables']['user_sessions']['Row']

interface DevicesClientProps {
  sessions: Session[]
  userId: string
}

export function DevicesClient({ sessions, userId }: DevicesClientProps) {
  const router = useRouter()
  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false)
  const [loggingOutId, setLoggingOutId] = useState<string | null>(null)

  const getDeviceIcon = (deviceType: string | null) => {
    switch (deviceType) {
      case 'mobile':
        return <Smartphone className="h-8 w-8" />
      case 'tablet':
        return <Tablet className="h-8 w-8" />
      default:
        return <Monitor className="h-8 w-8" />
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const handleLogoutDevice = async (sessionId: string) => {
    setLoggingOutId(sessionId)
    
    try {
      const response = await fetch('/api/auth/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      })

      if (!response.ok) {
        throw new Error('세션 로그아웃에 실패했습니다.')
      }

      toast.success('해당 기기에서 로그아웃되었습니다.')
      router.refresh()
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setLoggingOutId(null)
    }
  }

  const handleLogoutAll = async () => {
    if (!confirm('다른 모든 기기에서 로그아웃하시겠습니까?')) return
    
    setIsLoggingOutAll(true)
    
    try {
      const response = await fetch('/api/auth/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoutAll: true })
      })

      if (!response.ok) {
        throw new Error('전체 로그아웃에 실패했습니다.')
      }

      toast.success('다른 모든 기기에서 로그아웃되었습니다.')
      router.refresh()
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsLoggingOutAll(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle>로그인 기기 관리</CardTitle>
              <CardDescription>
                현재 로그인된 기기 목록입니다. 의심스러운 기기가 있다면 로그아웃하세요.
              </CardDescription>
            </div>
            {sessions.length > 1 && (
              <Button 
                variant="destructive" 
                onClick={handleLogoutAll}
                disabled={isLoggingOutAll}
              >
                {isLoggingOutAll && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                다른 기기 전체 로그아웃
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Monitor className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <p>로그인 기록이 없습니다.</p>
              <p className="text-sm text-gray-400 mt-2">
                새로운 로그인 시 기기 정보가 자동으로 기록됩니다.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {sessions.map((session) => (
                <div 
                  key={session.id} 
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    session.is_current ? 'bg-primary/5 border-primary' : 'bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="text-gray-400">
                      {getDeviceIcon(session.device_type)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {session.browser || '알 수 없는 브라우저'}
                          {session.os && ` - ${session.os}`}
                        </span>
                        {session.is_current && (
                          <Badge variant="default" className="text-xs">현재 기기</Badge>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        <span>IP: {session.ip_address || '알 수 없음'}</span>
                        <span className="mx-2">•</span>
                        <span>마지막 활동: {formatDate(session.last_active)}</span>
                      </div>
                      {session.device_info && (
                        <div className="text-xs text-gray-400 mt-1">
                          {session.device_info}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {!session.is_current && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleLogoutDevice(session.id)}
                      disabled={loggingOutId === session.id}
                    >
                      {loggingOutId === session.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <LogOut className="h-4 w-4 mr-1" />
                          로그아웃
                        </>
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Login History Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">보안 안내</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-600">
          <p>• 로그인 시 기기 정보가 자동으로 기록됩니다.</p>
          <p>• 본인이 아닌 기기에서의 로그인이 확인되면 즉시 해당 기기를 로그아웃하세요.</p>
          <p>• 공용 컴퓨터 사용 후에는 반드시 로그아웃해주세요.</p>
          <p>• 의심스러운 활동이 발견되면 비밀번호를 변경해주세요.</p>
        </CardContent>
      </Card>
    </div>
  )
}


