'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { StudioAlertDialog } from '@/components/design-system/studio-dialog'

export function LoginCompleteDialog() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isLoginComplete = searchParams.get('login') === 'success'
  const isLogoutComplete = searchParams.get('logout') === 'success'
  const isOpen = isLoginComplete || isLogoutComplete

  const handleClose = () => {
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.delete('login')
    nextParams.delete('logout')
    const nextSearch = nextParams.toString()
    const nextHash = window.location.hash
    const nextUrl = `${pathname}${nextSearch ? `?${nextSearch}` : ''}${nextHash}`

    router.replace(nextUrl, { scroll: false })
  }

  return (
    <StudioAlertDialog
      open={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      title={isLogoutComplete ? '로그아웃 완료' : '로그인 완료'}
      description={isLogoutComplete ? '로그아웃되었습니다.' : '로그인이 완료되었습니다.'}
      onConfirm={handleClose}
    />
  )
}
