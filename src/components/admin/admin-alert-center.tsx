'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ADMIN_WORK_ITEMS, dispatchStatusMessages } from '@/lib/admin-alerts'
import { useAdminAlerts } from './admin-alert-context'

// 심각도는 색만이 아니라 글자로도 보인다.
const SEVERITY_MARKERS: Record<string, { label: string; className: string }> = {
  critical: { label: '긴급', className: 'bg-red-100 text-red-700' },
  warning: { label: '주의', className: 'bg-amber-100 text-amber-800' },
  info: { label: '안내', className: 'bg-gray-100 text-gray-600' },
}

const formatEventTime = (value: string) =>
  new Date(value).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

// 종 버튼 + 알림 패널. 값은 AdminAlertProvider가 한 번 조회·구독한 것을 쓴다.
// compact: 종 옆 글자를 숨기고 표시만 남긴다(접힌 사이드바·모바일).
export function AdminAlertCenter({ className, compact = false }: { className?: string; compact?: boolean }) {
  const alerts = useAdminAlerts()
  const [open, setOpen] = useState(false)
  const [permission, setPermission] = useState(() => (typeof Notification === 'undefined' ? null : Notification.permission))

  if (!alerts) return null
  const { realtimeDown, soundOn, toggleSound, markSeen, openLink } = alerts
  // 가장 최근 조회가 실패했으면 옛 값을 현재 값처럼 보여 주지 않는다.
  const summary = alerts.loadFailed ? null : alerts.summary
  const unreadCount = alerts.loadFailed ? null : summary ? summary.unreadCount : 0
  const bellLabel = [
    alerts.loadFailed ? '알림 확인 불가' : '알림',
    ...(summary ? [unreadCount === null ? '미확인 건수 확인 불가' : `미확인 ${unreadCount}건`] : []),
    ...(realtimeDown ? ['실시간 연결 끊김'] : []),
  ].join(', ')
  const statusMessages = summary ? dispatchStatusMessages(summary.dispatch) : []

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    // 화면에 실제로 보인 가장 최근 이벤트까지만 확인한 것으로 기록한다(열 때, 그리고 열어 둔 동안 온 것은 닫을 때).
    // 목록을 보여 주지 못했으면(조회 실패·목록 없음) 기록하지 않는다.
    const newestId = summary?.events?.[0]?.id
    if (newestId && summary.unreadCount !== 0) markSeen(newestId)
  }

  const askNotificationPermission = () => {
    try {
      // 옛 브라우저는 Promise 대신 콜백으로만 결과를 준다.
      const result: Promise<NotificationPermission> | undefined = Notification.requestPermission(setPermission)
      result?.then(setPermission).catch(() => undefined)
    } catch {
      // 요청하지 못하면 버튼만 그대로 남는다.
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={bellLabel}
            className={cn('relative rounded-md p-2 outline-none focus-visible:ring-2 focus-visible:ring-orange-500', className)}
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            {unreadCount !== 0 ? (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white"
              >
                {unreadCount === null ? '!' : unreadCount > 99 ? '99+' : unreadCount}
              </span>
            ) : null}
            {realtimeDown && compact ? (
              <span
                aria-hidden="true"
                className="absolute -bottom-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-slate-900"
              >
                ×
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" aria-label="알림" className="w-80 max-w-[calc(100vw-2rem)] p-0 text-gray-900">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">알림</h2>
            {realtimeDown ? <span className="text-xs font-medium text-amber-700">실시간 연결 끊김</span> : null}
          </div>

          {!summary ? (
            <p className="px-4 py-6 text-center text-sm text-gray-500">
              {alerts.loadFailed ? '알림을 불러오지 못했습니다.' : '불러오는 중…'}
            </p>
          ) : (
            <>
              <div className="max-h-72 overflow-y-auto">
                {summary.events === null ? (
                  <p className="px-4 py-6 text-center text-sm text-gray-500">알림 목록 확인 불가</p>
                ) : summary.events.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-gray-500">알림이 없습니다.</p>
                ) : (
                  <ul className="divide-y">
                    {summary.events.map((event) => {
                      const marker = SEVERITY_MARKERS[event.severity] ?? SEVERITY_MARKERS.info
                      return (
                        <li key={event.id}>
                          <button
                            type="button"
                            className="w-full px-4 py-3 text-left hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none"
                            onClick={() => {
                              setOpen(false)
                              openLink(event.link)
                            }}
                          >
                            <span className="flex items-start gap-2">
                              <span className={cn('mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold', marker.className)}>
                                {marker.label}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium">{event.title}</span>
                                {event.body ? <span className="block text-xs text-gray-600">{event.body}</span> : null}
                                <span className="block text-[11px] text-gray-400">{formatEventTime(event.created_at)}</span>
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <div className="border-t px-4 py-3">
                <h3 className="mb-1 text-xs font-semibold text-gray-500">처리 대기</h3>
                <ul>
                  {ADMIN_WORK_ITEMS.map((item) => {
                    const value = summary.work[item.key]
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className="flex items-center justify-between gap-3 py-1 text-sm hover:underline"
                        >
                          <span className={value !== 0 ? 'font-semibold' : 'text-gray-600'}>{item.label}</span>
                          <span className={value !== 0 ? 'font-bold text-red-700' : 'text-gray-400'}>
                            {value === null ? '확인 불가' : value.toLocaleString()}
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>

              {statusMessages.length > 0 ? (
                <p role="status" className="border-t bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800">
                  {statusMessages.join(' · ')}
                </p>
              ) : null}
            </>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2 text-xs">
            <button
              type="button"
              aria-pressed={soundOn}
              onClick={toggleSound}
              className="rounded border px-2 py-1 hover:bg-gray-50"
            >
              {soundOn ? '소리 켜짐' : '소리 꺼짐'}
            </button>
            {permission === 'default' ? (
              <button
                type="button"
                onClick={askNotificationPermission}
                className="rounded border px-2 py-1 hover:bg-gray-50"
              >
                브라우저 알림 허용
              </button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      {realtimeDown ? (
        <span className={compact ? 'sr-only' : 'text-[11px] font-medium text-amber-300'}>실시간 연결 끊김</span>
      ) : null}
    </div>
  )
}
