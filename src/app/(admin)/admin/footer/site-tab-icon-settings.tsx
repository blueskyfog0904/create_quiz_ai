'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSiteLogoUrl } from '@/components/layout/site-logo'
import { DEFAULT_SITE_LOGO_PATH, SITE_LOGO_MAX_BYTES, SITE_LOGO_MIME_TYPES, SITE_LOGO_SIZE } from '@/lib/site-logo'
import { AdminNotice } from '@/components/admin/kit/admin-notice'

// 브라우저 탭 아이콘 올리기. 따로 올리지 않으면 사이트 로고가 탭 아이콘으로 쓰인다.
export function SiteTabIconSettings({ initialUrl }: { initialUrl: string | null }) {
  const logoUrl = useSiteLogoUrl()
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  // 저장·되돌리기 직후에는 새로고침 전에도 결과를 바로 보여 준다
  const [tabIconUrl, setTabIconUrl] = useState(initialUrl)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inputKey, setInputKey] = useState(0)

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  async function saveTabIcon() {
    if (!file || isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch('/api/admin/site-logo/tab-icon', { method: 'POST', body: form })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '탭 아이콘을 저장하지 못했습니다.')
      setTabIconUrl(result.url)
      setFile(null)
      setPreview(null)
      setInputKey((key) => key + 1)
      toast.success('탭 아이콘을 저장했습니다. 브라우저 탭에는 조금 뒤에 바뀌어 보일 수 있습니다.')
      router.refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : '업로드에 실패했습니다. 다시 시도해주세요.')
    } finally {
      setIsSaving(false)
    }
  }

  async function resetTabIcon() {
    if (isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/site-logo/tab-icon', { method: 'DELETE' })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || '사이트 로고로 되돌리지 못했습니다.')
      setTabIconUrl(null)
      toast.success('탭 아이콘을 사이트 로고로 되돌렸습니다.')
      router.refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : '사이트 로고로 되돌리지 못했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  const shownUrl = preview || tabIconUrl || logoUrl || DEFAULT_SITE_LOGO_PATH
  const shownLabel = file ? '선택한 탭 아이콘 미리보기' : '현재 탭 아이콘'

  return (
    <Card>
      <CardHeader>
        <CardTitle>브라우저 탭 아이콘</CardTitle>
        <CardDescription>브라우저 탭과 즐겨찾기에 보이는 작은 그림입니다. 따로 올리지 않으면 사이트 로고를 그대로 씁니다.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-24 w-24 items-center justify-center rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-2">
            <Image
              src={shownUrl}
              alt={shownLabel}
              width={SITE_LOGO_SIZE}
              height={SITE_LOGO_SIZE}
              className="h-full w-full object-contain"
              unoptimized
            />
          </div>
          {/* 탭에서는 아주 작게 보이므로 실제 크기로도 보여 준다 */}
          <div className="space-y-2 text-sm text-[var(--studio-muted)]">
            <p>탭에서 보이는 크기</p>
            <div className="flex items-end gap-3" aria-hidden="true">
              {[16, 32].map((size) => (
                <Image key={size} src={shownUrl} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: 'contain' }} unoptimized />
              ))}
            </div>
          </div>
          <div className="space-y-1 text-sm text-[var(--studio-muted)]" id="site-tab-icon-help">
            <p>{tabIconUrl ? '지금은 따로 올린 탭 아이콘을 쓰고 있습니다.' : '지금은 사이트 로고를 탭 아이콘으로 쓰고 있습니다.'}</p>
            <p>권장: 정사각형, 글자 없이 단순한 그림(작게 줄여도 알아볼 수 있는 것)</p>
            <p>PNG·JPG·WebP / 최대 5MB / 2,500만 픽셀 이하 / 정지 이미지</p>
            <p>올린 이미지는 {SITE_LOGO_SIZE} × {SITE_LOGO_SIZE}px 로 자동 변환합니다. 이미지를 자르지 않고 남는 공간은 투명 여백으로 채웁니다.</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="site-tab-icon-file">탭 아이콘 이미지 파일</Label>
          <Input
            key={inputKey}
            id="site-tab-icon-file"
            type="file"
            accept={SITE_LOGO_MIME_TYPES.join(',')}
            aria-describedby="site-tab-icon-help"
            disabled={isSaving}
            className="min-h-11"
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null
              setFile(null)
              setPreview(null)
              setError(null)
              if (!selected) return
              if (!SITE_LOGO_MIME_TYPES.includes(selected.type) || selected.size === 0 || selected.size > SITE_LOGO_MAX_BYTES) {
                setError('5MB 이하의 PNG, JPG, WebP 이미지를 선택해주세요.')
                event.target.value = ''
                return
              }
              setFile(selected)
              setPreview(URL.createObjectURL(selected))
            }}
          />
        </div>
        {error && <AdminNotice kind="error">{error}</AdminNotice>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="brand" className="min-h-11" disabled={!file || isSaving} onClick={saveTabIcon}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {isSaving ? '변환 및 저장 중…' : '탭 아이콘 저장 및 적용'}
          </Button>
          {tabIconUrl ? (
            <Button type="button" variant="brandOutline" className="min-h-11" disabled={isSaving} onClick={resetTabIcon}>
              사이트 로고로 되돌리기
            </Button>
          ) : null}
          <p className="text-sm text-[var(--studio-muted)]">파일 선택 후 저장하면 바로 적용됩니다. 브라우저가 예전 아이콘을 기억하고 있으면 바뀌어 보이기까지 시간이 걸릴 수 있습니다.</p>
        </div>
      </CardContent>
    </Card>
  )
}
