'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
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
    try {
      const result = await saveStorefrontHeaderLinksAction(links)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setLinks(result.data)
      setSavedLinks(result.data)
      toast.success('상단 메뉴를 저장했습니다.')
      router.refresh()
    } catch {
      toast.error('상단 메뉴를 저장하지 못했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900"><AdminMenuName href="/admin/storefront-menu" fallback="상단 메뉴" /></h1>
          <p className="mt-1 text-gray-500">회원 화면 헤더 오른쪽에 보이는 링크(크레딧 충전 등)를 관리합니다. 국어·영어 화면에 함께 보입니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setLinks(savedLinks)} disabled={loadFailed || isSaving || !hasChanges}>
            되돌리기
          </Button>
          <Button onClick={handleSave} disabled={loadFailed || Boolean(invalid) || isSaving || !hasChanges}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            저장
          </Button>
        </div>
      </div>

      {loadFailed ? (
        <p role="alert" className="text-sm text-destructive">저장된 링크를 읽지 못했습니다. 새로고침한 뒤 다시 시도해 주세요. (덮어쓰지 않도록 저장을 막았습니다)</p>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>헤더 링크</CardTitle>
            <CardDescription>
              최대 {STOREFRONT_HEADER_LINK_MAX_COUNT}개. 주소는 /로 시작하는 사이트 주소(예: /pricing) 또는 https:// 주소(새 창으로 열림)를 넣습니다.
              카테고리·국어·영어 탭은 화면 구조라 여기서 바꾸지 않습니다.
            </CardDescription>
          </div>
          <Button
            variant="adminAction"
            onClick={() => setLinks((current) => [...current, { label: '', href: '', isActive: true, emphasis: false }])}
            disabled={loadFailed || isSaving || links.length >= STOREFRONT_HEADER_LINK_MAX_COUNT}
          >
            <Plus className="mr-2 h-4 w-4" />
            링크 추가
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {links.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-gray-500">링크가 없습니다. 헤더 오른쪽에는 아무것도 보이지 않습니다.</p>
          ) : null}
          {links.map((link, index) => (
            <div key={index} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_1.4fr_auto]">
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
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <Switch checked={link.isActive} disabled={loadFailed || isSaving} onCheckedChange={(checked) => update(index, { isActive: checked })} />
                  {link.isActive ? '보임' : '숨김'}
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <Switch checked={link.emphasis} disabled={loadFailed || isSaving} onCheckedChange={(checked) => update(index, { emphasis: checked })} />
                  강조
                </label>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label={`${link.label || `${index + 1}번째 링크`} 위로 이동`} disabled={loadFailed || isSaving || index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`${link.label || `${index + 1}번째 링크`} 아래로 이동`} disabled={loadFailed || isSaving || index === links.length - 1} onClick={() => move(index, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`${link.label || `${index + 1}번째 링크`} 삭제`} disabled={loadFailed || isSaving} onClick={() => setLinks((current) => current.filter((_, linkIndex) => linkIndex !== index))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {invalid && !loadFailed ? <p className="text-sm text-amber-700">{invalid}</p> : null}
          <p className="text-xs text-gray-500">추가·삭제·순서 변경은 저장해야 반영됩니다. 저장하면 회원 화면에 바로 반영됩니다.</p>
        </CardContent>
      </Card>
    </div>
  )
}
