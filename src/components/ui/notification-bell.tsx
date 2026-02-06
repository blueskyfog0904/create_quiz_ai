'use client'

import { useState, useEffect } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

interface Notification {
  id: string
  title: string
  message: string
  type: string
  link: string | null
  is_read: boolean
  created_at: string
}

// ... imports

interface NotificationBellProps {
  isAdmin?: boolean
}

export function NotificationBell({ isAdmin = false }: NotificationBellProps) {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [adminPendingCount, setAdminPendingCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)

  const fetchNotifications = async () => {
    try {
      // 1. Fetch User Notifications
      const res = await fetch('/api/notifications', { cache: 'no-store' })
      let userUnread = 0
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications || [])
        userUnread = data.notifications.filter((n: Notification) => !n.is_read).length
      }

      // 2. Fetch Admin Stats (if admin)
      let adminPending = 0
      if (isAdmin) {
        const adminRes = await fetch('/api/admin/support/stats', { cache: 'no-store' })
        if (adminRes.ok) {
          const adminData = await adminRes.json()
          adminPending = adminData.pendingCount || 0
        }
      }

      setAdminPendingCount(adminPending)
      setUnreadCount(userUnread + adminPending)

    } catch (error) {
      console.error('Failed to fetch notifications', error)
    }
  }

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 60000)
    return () => clearInterval(interval)
  }, [isAdmin])

  // ... handleRead, handleMarkAllRead functions (unchanged)

  const handleRead = async (notification: Notification) => {
    if (!notification.is_read) {
      // Optimistic update
      setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, is_read: true } : n))
      // Decrease count safely (but check logic with admin count)
      // Since unreadCount is sum, we re-calculate or just subtract 1
      setUnreadCount(prev => Math.max(0, prev - 1))

      try {
        await fetch('/api/notifications', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: notification.id })
        })
      } catch (error) {
        console.error('Failed to mark read', error)
      }
    }

    if (notification.link) {
      setIsOpen(false)
      router.push(notification.link)
    }
  }

  const handleMarkAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    // If admin pending exists, unreadCount only becomes adminPendingCount
    setUnreadCount(adminPendingCount)
    
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true })
      })
    } catch (error) {
      console.error('Failed to mark all read', error)
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white ring-2 ring-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h4 className="font-semibold text-sm">알림</h4>
          {notifications.some(n => !n.is_read) && (
            <Button variant="ghost" size="sm" className="h-auto p-0 text-xs text-gray-500 hover:text-gray-900" onClick={handleMarkAllRead}>
              모두 읽음
            </Button>
          )}
        </div>
        
        <div className="max-h-[300px] overflow-y-auto">
          {/* Admin Section */}
          {isAdmin && adminPendingCount > 0 && (
            <div 
              className="p-4 bg-orange-50 hover:bg-orange-100 cursor-pointer border-b transition-colors"
              onClick={() => {
                setIsOpen(false)
                router.push('/admin/support')
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-orange-800">대기 중인 문의</p>
                  <p className="text-xs text-orange-600">고객 문의가 {adminPendingCount}건 있습니다.</p>
                </div>
                <Badge variant="secondary" className="bg-orange-200 text-orange-800 hover:bg-orange-300">
                  {adminPendingCount}
                </Badge>
              </div>
            </div>
          )}

          {/* User Notifications */}
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              새로운 알림이 없습니다.
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={cn(
                    "p-4 hover:bg-gray-50 cursor-pointer transition-colors",
                    !notification.is_read && "bg-blue-50/50"
                  )}
                  onClick={() => handleRead(notification)}
                >
                  <div className="space-y-1">
                    <p className={cn("text-sm font-medium", !notification.is_read && "text-blue-700")}>
                      {notification.title}
                    </p>
                    <p className="text-xs text-gray-500 line-clamp-2">
                      {notification.message}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {new Date(notification.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
