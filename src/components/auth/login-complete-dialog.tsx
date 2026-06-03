'use client'

import { CheckCircle2 } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function LoginCompleteDialog() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isOpen = searchParams.get('login') === 'success'

  const handleClose = () => {
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.delete('login')
    const nextSearch = nextParams.toString()
    const nextHash = window.location.hash
    const nextUrl = `${pathname}${nextSearch ? `?${nextSearch}` : ''}${nextHash}`

    router.replace(nextUrl, { scroll: false })
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader className="items-center text-center sm:text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          </div>
          <DialogTitle>로그인 완료</DialogTitle>
          <DialogDescription className="text-center leading-6">
            로그인이 완료되었습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center">
          <Button type="button" className="min-w-24" onClick={handleClose}>
            확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
