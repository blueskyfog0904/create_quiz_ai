'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  SITE_BRAND_DESCRIPTION_MAX_LENGTH,
  SITE_BRAND_NAME_MAX_LENGTH,
  validateSiteBrand,
  type SiteBrand,
} from '@/lib/site-brand'
import { saveSiteBrandAction } from './actions'

// 사이트 이름·소개 문구. 회원 화면 헤더, 브라우저 탭 제목(" | 사이트 이름"), 하단, 약관 화면에 쓰인다.
export function SiteBrandForm({ initial }: { initial: SiteBrand | null }) {
  const router = useRouter()
  const [saved, setSaved] = useState<SiteBrand | null>(initial)
  const [draft, setDraft] = useState<SiteBrand>(initial ?? { name: '', description: '' })
  const [isSaving, setIsSaving] = useState(false)
  const loadFailed = initial === null
  const hasChanges = saved === null || draft.name !== saved.name || draft.description !== saved.description
  const invalid = validateSiteBrand(draft)

  async function handleSave() {
    if (loadFailed || invalid || isSaving) return
    setIsSaving(true)
    try {
      const result = await saveSiteBrandAction(draft)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setSaved(result.data)
      setDraft(result.data)
      toast.success('사이트 기본 정보를 저장했습니다.')
      router.refresh()
    } catch {
      toast.error('사이트 기본 정보를 저장하지 못했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>사이트 이름</CardTitle>
        <CardDescription>회원 화면 헤더, 브라우저 탭 제목, 하단, 약관 화면에 쓰입니다.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadFailed ? (
          <p role="alert" className="text-sm text-destructive">저장된 값을 읽지 못했습니다. 새로고침한 뒤 다시 시도해 주세요. (덮어쓰지 않도록 저장을 막았습니다)</p>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="site-brand-name">사이트 이름</Label>
          <Input
            id="site-brand-name"
            value={draft.name}
            maxLength={SITE_BRAND_NAME_MAX_LENGTH}
            disabled={loadFailed || isSaving}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="site-brand-description">소개 문구 (검색 결과·공유 미리보기 설명)</Label>
          <Textarea
            id="site-brand-description"
            rows={2}
            value={draft.description}
            maxLength={SITE_BRAND_DESCRIPTION_MAX_LENGTH}
            disabled={loadFailed || isSaving}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
          />
        </div>
        {invalid && !loadFailed ? <p className="text-sm text-amber-700">{invalid}</p> : null}
        <Button type="button" onClick={handleSave} disabled={loadFailed || Boolean(invalid) || isSaving || !hasChanges}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          사이트 이름 저장
        </Button>
      </CardContent>
    </Card>
  )
}
