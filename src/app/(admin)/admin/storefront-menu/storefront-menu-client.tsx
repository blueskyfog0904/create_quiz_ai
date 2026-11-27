'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { AdminSaveBar, countChangedFields } from '@/components/admin/kit/admin-save-bar'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import {
  STOREFRONT_HEADER_LINK_LABEL_MAX_LENGTH,
  STOREFRONT_HEADER_LINK_MAX_COUNT,
  validateStorefrontHeaderLinks,
  type StorefrontHeaderLink,
} from '@/lib/storefront-header-links'
import { saveStorefrontHeaderLinksAction } from './actions'

export function StorefrontMenuClient({ initialLinks }: { initialLinks: StorefrontHeaderLink[] | null }) {
  const router = useRouter()
  const loadFailed = initialLinks === null
  const [links, setLinks] = useState<StorefrontHeaderLink[]>(initialLinks ?? [])
  const [savedLinks, setSavedLinks] = useState<StorefrontHeaderLink[]>(initialLinks ?? [])
  const [isSaving, setIsSaving] = useState(false)
  // 저장 상태 표시(20번 저장 바): 마지막 저장 시각·실패 글. 저장 동작은 그대로.
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const hasChanges = JSON.stringify(links) !== JSON.stringify(savedLinks)
  const invalid = validateStorefrontHeaderLinks(links)

  const update = (index: number, next: Partial<StorefrontHeaderLink>) => {
    setLinks((current) => current.map((link, linkIndex) => (linkIndex === index ? { ...link, ...next } : link)))
  }
  const move = (index: number, direction: -1 | 1) => {
    setLinks((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function handleSave() {
    if (loadFailed || invalid || isSaving) return
    setIsSaving(true)
    setSaveError(null)
    try {
      const result = await saveStorefrontHeaderLinksAction(links)
      if (!result.success) {
        toast.error(result.error)
        setSaveError(result.error)
        return
      }
      setLinks(result.data)
      setSavedLinks(result.data)
      setSavedAt(Date.now())
      toast.success('상단 메뉴를 저장했습니다.')
      router.refresh()
    } catch {
      toast.error('상단 메뉴를 저장하지 못했습니다.')
      setSaveError('상단 메뉴를 저장하지 못했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div>
      <AdminPageHeader
        title={<AdminMenuName href="/admin/storefront-menu" fallback="상단 메뉴" />}
        description="회원 화면 헤더 오른쪽에 보이는 링크(크레딧 충전 등)를 관리합니다. 국어·영어 화면에 함께 보입니다."
        tools={
          <Button variant="brandOutline" onClick={() => setLinks(savedLinks)} disabled={loadFailed || isSaving || !hasChanges}>
            되돌리기
          </Button>
        }
      />

      <div className="space-y-6">
      {loadFailed ? (
        <AdminNotice kind="error">저장된 링크를 읽지 못했습니다. 새로고침한 뒤 다시 시도해 주세요. (덮어쓰지 않도록 저장을 막았습니다)</AdminNotice>
      ) : null}

      <section className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]">
        <div className="flex flex-col gap-3 p-6 max-md:p-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1.5">
            <h2 className="font-semibold text-[var(--studio-ink)]">헤더 링크</h2>
            <p className="text-sm text-[var(--studio-muted)]">
              최대 {STOREFRONT_HEADER_LINK_MAX_COUNT}개. 주소는 /로 시작하는 사이트 주소(예: /pricing) 또는 https:// 주소(새 창으로 열림)를 넣습니다.
              카테고리·국어·영어 탭은 화면 구조라 여기서 바꾸지 않습니다.
            </p>
          </div>
          <Button
            variant="brandOutline"
            onClick={() => setLinks((current) => [...current, { label: '', href: '', isActive: true, emphasis: false }])}
            disabled={loadFailed || isSaving || links.length >= STOREFRONT_HEADER_LINK_MAX_COUNT}
          >
            <Plus className="mr-2 h-4 w-4" />
            링크 추가
          </Button>
        </div>
        <div className="space-y-3 px-6 pb-6 max-md:px-4 max-md:pb-4">
          {links.length === 0 ? (
            <AdminTableState kind="empty" message="링크가 없습니다. 헤더 오른쪽에는 아무것도 보이지 않습니다." />
          ) : null}
          {links.map((link, index) => (
            <div key={index} className="grid gap-3 rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] p-4 md:grid-cols-[1fr_1.4fr_auto]">
              <div className="space-y-1">
                <Label htmlFor={`storefront-link-label-${index}`}>이름</Label>
                <Input
                  id={`storefront-link-label-${index}`}
                  value={link.label}
                  maxLength={STOREFRONT_HEADER_LINK_LABEL_MAX_LENGTH}
                  disabled={loadFailed || isSaving}
                  onChange={(event) => update(index, { label: event.target.value })}
                  placeholder="예: 크레딧 충전"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`storefront-link-href-${index}`}>주소</Label>
                <Input
                  id={`storefront-link-href-${index}`}
                  value={link.href}
                  disabled={loadFailed || isSaving}
                  onChange={(event) => update(index, { href: event.target.value })}
                  placeholder="예: /pricing"
                />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex items-center gap-2 text-sm text-[var(--studio-text)]">
                  <Switch checked={link.isActive} disabled={loadFailed || isSaving} onCheckedChange={(checked) => update(index, { isActive: checked })} />
                  {link.isActive ? '보임' : '숨김'}
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--studio-text)]">
                  <Switch checked={link.emphasis} disabled={loadFailed || isSaving} onCheckedChange={(checked) => update(index, { emphasis: checked })} />
                  강조
                </label>
                <div className="flex items-center gap-1">
                  <Button variant="adminTable" size="icon-sm" aria-label={`${link.label || `${index + 1}번째 링크`} 위로 이동`} disabled={loadFailed || isSaving || index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="adminTable" size="icon-sm" aria-label={`${link.label || `${index + 1}번째 링크`} 아래로 이동`} disabled={loadFailed || isSaving || index === links.length - 1} onClick={() => move(index, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button variant="adminTable" size="icon-sm" aria-label={`${link.label || `${index + 1}번째 링크`} 삭제`} disabled={loadFailed || isSaving} onClick={() => setLinks((current) => current.filter((_, linkIndex) => linkIndex !== index))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {invalid && !loadFailed ? <AdminNotice kind="warning">{invalid}</AdminNotice> : null}
        </div>
      </section>
      </div>

      <AdminSaveBar
        variant="fixed"
        dirtyCount={countChangedFields(links, savedLinks)}
        status={isSaving ? 'saving' : saveError ? 'error' : savedAt ? 'saved' : 'idle'}
        savedAt={savedAt}
        errorMessage={saveError}
        applyNote="추가·삭제·순서 변경은 저장해야 반영됩니다. 저장하면 회원 화면에 바로 반영됩니다."
        onSave={() => void handleSave()}
        saveDisabled={loadFailed || Boolean(invalid) || isSaving || !hasChanges}
      />
    </div>
  )
}
