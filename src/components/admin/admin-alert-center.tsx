'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ADMIN_WORK_ITEMS, dispatchStatusMessages, workTotal } from '@/lib/admin-alerts'
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
  const { realtimeDown, soundOn, toggleSound, openLink } = alerts
  // 가장 최근 조회가 실패했으면 옛 값을 현재 값처럼 보여 주지 않는다.
  const summary = alerts.loadFailed ? null : alerts.summary
  // 종의 숫자는 "처리하지 않은 건수"다. 패널을 열어 확인해도 줄지 않고, 처리해야 준다.
  // 첫 조회 전에는 표시하지 않고(0), 조회 실패·일부 확인 불가면 null('!').
  const pendingCount = alerts.loadFailed ? null : summary ? workTotal(summary.work) : 0
  const bellLabel = [
    alerts.loadFailed ? '알림 확인 불가' : '알림',
    ...(summary ? [pendingCount === null ? '처리 대기 건수 확인 불가' : `처리 대기 ${pendingCount}건`] : []),
    ...(realtimeDown ? ['실시간 연결 끊김'] : []),
  ].join(', ')
  const statusMessages = summary ? dispatchStatusMessages(summary.dispatch) : []

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
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={bellLabel}
            className={cn('relative rounded-md p-2 outline-none focus-visible:ring-2 focus-visible:ring-orange-500', className)}
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            {pendingCount !== 0 ? (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white"
              >
                {pendingCount === null ? '!' : pendingCount > 99 ? '99+' : pendingCount}
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
        {/* 화면 가장자리에서 8px 띄우고, 화면보다 길면 패널 안에서 스크롤한다(맨 아래 버튼이 잘리지 않게). */}
        <PopoverContent
          align="start"
          aria-label="알림"
          collisionPadding={8}
          className="max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto p-0 text-gray-900"
        >
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
              <div className="border-b px-4 py-3">
                <h3 className="mb-1 text-xs font-semibold text-gray-500">처리 대기</h3>
                <ul>
                  {ADMIN_WORK_ITEMS.map((item) => {
                    const value = summary.work[item.key]
                    // 0이 아니면(확인 불가 포함) 눈에 띄게 한다.
                    const needsAttention = value !== 0
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className="flex items-center justify-between gap-3 py-1.5 text-sm hover:bg-gray-50 max-md:min-h-10"
                        >
                          <span className={needsAttention ? 'font-semibold text-gray-900' : 'text-gray-600'}>{item.label}</span>
                          <span
                            className={
                              needsAttention
                                ? 'shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700'
                                : 'shrink-0 px-2.5 text-xs text-gray-400'
                            }
                          >
                            {value === null ? '확인 불가' : value.toLocaleString()}
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>

              <h3 className="px-4 pt-3 text-xs font-semibold text-gray-500">최근 알림</h3>
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
              className="rounded border px-3 py-1 hover:bg-gray-50 max-md:min-h-10"
            >
              {soundOn ? '소리 켜짐' : '소리 꺼짐'}
            </button>
            {permission === 'default' ? (
              <button
                type="button"
                onClick={askNotificationPermission}
                className="rounded border px-3 py-1 hover:bg-gray-50 max-md:min-h-10"
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
