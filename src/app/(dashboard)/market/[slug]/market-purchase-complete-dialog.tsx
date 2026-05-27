'use client'

import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface MarketPurchaseCompleteDialogProps {
  message: string | null
  onClose: () => void
}

export default function MarketPurchaseCompleteDialog({ message, onClose }: MarketPurchaseCompleteDialogProps) {
  return (
    <Dialog open={Boolean(message)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader className="items-center text-center sm:text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          </div>
          <DialogTitle>구매 완료</DialogTitle>
          <DialogDescription className="text-center leading-6">
            {message || ''}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center">
          <Button type="button" className="min-w-24" onClick={onClose}>
            확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
