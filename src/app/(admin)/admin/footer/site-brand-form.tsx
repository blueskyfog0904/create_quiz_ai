'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
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
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminSaveBar, countChangedFields } from '@/components/admin/kit/admin-save-bar'
import { ADMIN_TONE_TEXT_CLASSES } from '@/components/admin/kit/admin-tone-classes'
import { cn } from '@/lib/utils'

// 사이트 이름·소개 문구. 회원 화면 헤더, 브라우저 탭 제목(" | 사이트 이름"), 하단, 약관 화면에 쓰인다.
export function SiteBrandForm({ initial }: { initial: SiteBrand | null }) {
  const router = useRouter()
  const [saved, setSaved] = useState<SiteBrand | null>(initial)
  const [draft, setDraft] = useState<SiteBrand>(initial ?? { name: '', description: '' })
  const [isSaving, setIsSaving] = useState(false)
  // 저장 상태 줄(20번 3-2): 마지막 저장 시각·실패 문구. 알림(toast)은 그대로 띄운다.
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const loadFailed = initial === null
  const hasChanges = saved === null || draft.name !== saved.name || draft.description !== saved.description
  const invalid = validateSiteBrand(draft)
  const changedCount = saved === null ? 0 : countChangedFields(draft, saved)

  async function handleSave() {
    if (loadFailed || invalid || isSaving) return
    setIsSaving(true)
    setSaveError(null)
    try {
      const result = await saveSiteBrandAction(draft)
      if (!result.success) {
        toast.error(result.error)
        setSaveError(result.error)
        return
      }
      setSaved(result.data)
      setDraft(result.data)
      setSavedAt(Date.now())
      toast.success('사이트 기본 정보를 저장했습니다.')
      router.refresh()
    } catch {
      toast.error('사이트 기본 정보를 저장하지 못했습니다.')
      setSaveError('사이트 기본 정보를 저장하지 못했습니다.')
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
          <AdminNotice kind="error">저장된 값을 읽지 못했습니다. 새로고침한 뒤 다시 시도해 주세요. (덮어쓰지 않도록 저장을 막았습니다)</AdminNotice>
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
        {invalid && !loadFailed ? <p className={cn('text-sm', ADMIN_TONE_TEXT_CLASSES.warning)}>{invalid}</p> : null}
        {/* 저장 함수 하나 = 인라인 저장 줄 하나. 막힘 조건은 전과 같다(읽기 실패·검사 실패·저장 중·변경 없음). */}
        <AdminSaveBar
          variant="inline"
          dirtyCount={hasChanges ? Math.max(1, changedCount) : 0}
          status={isSaving ? 'saving' : saveError ? 'error' : savedAt ? 'saved' : 'idle'}
          savedAt={savedAt}
          errorMessage={saveError}
          applyNote="저장하면 회원 화면 헤더·탭 제목·하단·약관 화면에 반영됩니다."
          onSave={() => void handleSave()}
          saveLabel="사이트 이름 저장"
          saveDisabled={loadFailed || Boolean(invalid) || !hasChanges}
        />
      </CardContent>
    </Card>
  )
}
