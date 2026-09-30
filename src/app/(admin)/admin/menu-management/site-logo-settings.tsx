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
import { SITE_LOGO_MAX_BYTES, SITE_LOGO_MIME_TYPES, SITE_LOGO_SIZE } from '@/lib/site-logo'

export function SiteLogoSettings() {
  const savedUrl = useSiteLogoUrl()
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inputKey, setInputKey] = useState(0)

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  async function saveLogo() {
    if (!file || isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch('/api/admin/site-logo', { method: 'POST', body: form })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '로고를 저장하지 못했습니다.')
      setUploadedUrl(result.url)
      setFile(null)
      setPreview(null)
      setInputKey((key) => key + 1)
      toast.success('로고를 저장했습니다. 영어·국어 헤더와 푸터에 공통 적용됩니다.')
      router.refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : '업로드에 실패했습니다. 다시 시도해주세요.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>사이트 로고 이미지</CardTitle>
        <CardDescription>브랜드명 옆의 로고를 변경합니다. 영어·국어 헤더와 푸터에 공통으로 적용됩니다.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-24 w-24 items-center justify-center rounded-md border bg-background p-2">
            <Image
              src={preview || uploadedUrl || savedUrl || '/brand-mark.svg'}
              alt={file ? '선택한 로고 미리보기' : '현재 사이트 로고'}
              width={SITE_LOGO_SIZE}
              height={SITE_LOGO_SIZE}
              className="h-full w-full object-contain"
              unoptimized
            />
          </div>
          <div className="space-y-1 text-sm text-muted-foreground" id="site-logo-help">
            <p>권장: {SITE_LOGO_SIZE} × {SITE_LOGO_SIZE}px, 투명 배경 PNG</p>
            <p>PNG·JPG·WebP / 최대 5MB / 2,500만 픽셀 이하 / 정지 이미지</p>
            <p>크기가 달라도 비율을 유지해 자동 변환합니다. 남는 공간은 투명 여백으로 채우며 이미지를 자르지 않습니다.</p>
            <p>작은 이미지는 확대 시 흐릿해질 수 있습니다.</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="site-logo-file">로고 이미지 파일</Label>
          <Input
            key={inputKey}
            id="site-logo-file"
            type="file"
            accept={SITE_LOGO_MIME_TYPES.join(',')}
            aria-describedby="site-logo-help"
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
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" className="min-h-11" disabled={!file || isSaving} onClick={saveLogo}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {isSaving ? '변환 및 저장 중…' : '로고 저장 및 적용'}
          </Button>
          <p className="text-sm text-muted-foreground">파일 선택 후 저장하면 적용됩니다. 메뉴 설정 저장과 별도로 동작합니다.</p>
        </div>
      </CardContent>
    </Card>
  )
}
