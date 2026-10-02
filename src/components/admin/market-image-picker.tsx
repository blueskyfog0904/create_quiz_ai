'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MarketImageLibrary } from '@/components/admin/market-image-library'
import type { MarketImageDto } from '@/lib/market-images'

interface MarketImagePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (image: MarketImageDto) => void
  selectedImageId?: string | null
  title?: string
}

// 이미지 라이브러리의 선택 모드. 이미지를 누르거나 새로 올리면 바로 선택하고 닫는다.
export function MarketImagePicker({
  open,
  onOpenChange,
  onSelect,
  selectedImageId,
  title = '이미지 선택',
}: MarketImagePickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>라이브러리에서 이미지를 고르거나 새 이미지를 올리세요.</DialogDescription>
        </DialogHeader>
        <MarketImageLibrary
          mode="select"
          selectedImageId={selectedImageId}
          onSelect={(image) => {
            onSelect(image)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
