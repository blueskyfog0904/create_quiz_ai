'use client'

import { useRef, useState } from 'react'
import { ImagePlus, Images, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { MarketImagePicker } from '@/components/admin/market-image-picker'
import {
  readLastMarketImageFolder,
  sha256HexOfBlob,
  shrinkMarketImageForUpload,
  uploadMarketImageFiles,
  writeLastMarketImageFolder,
} from '@/lib/market-images-upload'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REUSED_MESSAGE = '이미 등록된 이미지를 재사용했습니다'
const FOLDER_FALLBACK_MESSAGE = '마지막으로 쓴 폴더가 없어 미분류에 올렸습니다.'

export interface MarketImageFieldValue {
  id: string
  publicUrl: string
}

interface MarketImageFieldProps {
  label: string
  value: MarketImageFieldValue | null
  onChange: (image: MarketImageFieldValue | null) => void
  disabled?: boolean
  // 이미지가 없을 때 대신 표시되는 이미지(예: 카테고리 항목 기본 이미지)와 안내 문구
  fallback?: { image: MarketImageFieldValue; description: string } | null
}

// 상품·카테고리 항목의 이미지 지정: 미리보기 + [이미지 선택][새로 업로드][제거]
export function MarketImageField({ label, value, onChange, disabled, fallback }: MarketImageFieldProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const preview = value ?? fallback?.image ?? null

  // 새로 업로드: 라이브러리와 같은 흐름(해시 확인 → 업로드)으로 마지막 사용 폴더(없으면 미분류)에 올리고 바로 지정한다.
  const upload = async (file: File) => {
    setIsUploading(true)
    try {
      const lastFolder = readLastMarketImageFolder()
      const folderId = lastFolder && UUID_PATTERN.test(lastFolder) ? lastFolder : null
      const outcome = await uploadMarketImageFiles([file], folderId, {
        prepare: shrinkMarketImageForUpload,
        hash: sha256HexOfBlob,
      })
      const image = outcome.images[0]
      if (!image) {
        toast.error(outcome.failures[0]?.error ?? '이미지를 업로드하지 못했습니다.')
        return
      }
      if (outcome.folderFallback) {
        writeLastMarketImageFolder('all')
        toast.info(FOLDER_FALLBACK_MESSAGE)
      }
      if (outcome.reusedCount > 0) toast.info(REUSED_MESSAGE)
      onChange({ id: image.id, publicUrl: image.publicUrl })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '이미지를 업로드하지 못했습니다.')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed bg-muted">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- market-images 공개 버킷 URL을 그대로 보여 준다.
            <img src={preview.publicUrl} alt={`${label} 미리보기`} className={`h-full w-full object-contain ${value ? '' : 'opacity-60'}`} />
          ) : (
            <span className="text-xs text-muted-foreground">없음</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="min-h-11" disabled={disabled || isUploading} onClick={() => setIsPickerOpen(true)}>
            <Images aria-hidden="true" />
            이미지 선택
          </Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={disabled || isUploading} onClick={() => inputRef.current?.click()}>
            {isUploading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ImagePlus aria-hidden="true" />}
            새로 업로드
          </Button>
          <Button type="button" variant="ghost" className="min-h-11" disabled={disabled || isUploading || !value} onClick={() => onChange(null)}>
            <X aria-hidden="true" />
            제거
          </Button>
        </div>
      </div>
      {!value && fallback ? <p className="text-xs text-muted-foreground">{fallback.description}</p> : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void upload(file)
        }}
      />
      <MarketImagePicker
        open={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        selectedImageId={value?.id ?? null}
        title={`${label} 선택`}
        onSelect={(image) => onChange({ id: image.id, publicUrl: image.publicUrl })}
      />
    </div>
  )
}
