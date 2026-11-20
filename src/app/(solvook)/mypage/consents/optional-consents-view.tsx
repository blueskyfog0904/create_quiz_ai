'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { ConsentTextLine } from '@/components/auth/consent-checklist'
import {
  formatConsentDate,
  formatOptionalResult,
  getConsentErrorMessage,
  splitConsentLines,
} from '@/lib/signup-consent'
import type { OptionalConsentEntry } from '@/lib/signup-consent-server'
import { setOptionalConsentAction } from './actions'

export function OptionalConsentsView({
  entries,
  resultTemplate,
  senderName,
}: {
  entries: OptionalConsentEntry[] | null
  resultTemplate: string | null
  senderName: string
}) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // 처리 결과 안내 틀을 읽지 못하면 켜기·끄기를 막는다(결과 통지 없이 바뀌지 않게).
  if (!entries || !resultTemplate) {
    return (
      <section className="grid gap-4">
        <h1 className="text-xl font-bold text-[var(--studio-ink)]">선택 동의 관리</h1>
        <p className="text-sm text-[var(--studio-muted)]">동의 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
      </section>
    )
  }

  const toggle = (entry: OptionalConsentEntry, agreed: boolean) => {
    setPendingId(entry.id)
    startTransition(async () => {
      const outcome = await setOptionalConsentAction(entry.id, entry.version, agreed)
      setPendingId(null)
      if (!outcome.ok) {
        toast.error(getConsentErrorMessage(outcome.code))
        router.refresh()
        return
      }
      const record = outcome.results.find((candidate) => candidate.item_id === entry.id)
      if (record && resultTemplate) {
        setNotice(formatOptionalResult(resultTemplate, {
          sender: senderName,
          itemLabel: entry.label,
          agreed: record.agreed,
          processedAt: record.created_at,
        }))
      }
      router.refresh()
    })
  }

  return (
    <section className="grid gap-4">
      <div>
        <h1 className="text-xl font-bold text-[var(--studio-ink)]">선택 동의 관리</h1>
        <p className="mt-1 text-sm text-[var(--studio-muted)]">선택 항목은 언제든 켜거나 끌 수 있습니다. 필수 항목은 서비스 이용에 필요해 여기서 바꿀 수 없습니다.</p>
      </div>
      {notice ? (
        <p role="status" className="rounded-lg bg-[var(--studio-surface)] px-4 py-3 text-sm text-[var(--studio-ink)]">{notice}</p>
      ) : null}
      {entries.length === 0 ? (
        <p className="text-sm text-[var(--studio-muted)]">관리할 선택 동의 항목이 없습니다.</p>
      ) : (
        <ul className="grid gap-3">
          {entries.map((entry) => {
            const agreed = entry.latest?.agreed === true
            const stale = entry.latest && entry.latest.itemVersion !== entry.version
            return (
              <li key={entry.id} className="rounded-xl border border-[var(--studio-border)] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--studio-ink)]">
                      {entry.label}
                      {!entry.isActive ? <span className="ml-2 text-xs font-normal text-[var(--studio-muted)]">(더 이상 새로 받지 않는 항목)</span> : null}
                    </p>
                    <p className="mt-1 text-xs text-[var(--studio-muted)]">
                      {entry.latest
                        ? `${agreed ? '동의함' : '동의하지 않음'} · ${formatConsentDate(entry.latest.createdAt)}${stale ? ' · 이전 안내 기준' : ''}`
                        : '아직 선택하지 않음'}
                    </p>
                  </div>
                  <Switch
                    checked={agreed}
                    disabled={pendingId === entry.id || (!entry.isActive && !agreed)}
                    onCheckedChange={(value) => toggle(entry, value)}
                    aria-label={`${entry.label} ${agreed ? '철회' : '동의'}`}
                  />
                </div>
                <div className="mt-2 space-y-0.5 whitespace-pre-line break-keep text-xs leading-5 text-[var(--studio-muted)]">
                  {splitConsentLines(entry.content).map((line, index) => <p key={index}><ConsentTextLine line={line} /></p>)}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
