'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { buildAuthRedirectPath } from '@/lib/auth-paths'

export function useLoginRedirect() {
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const searchParams = useSearchParams()

  const currentLocation = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
  const loginHref = buildAuthRedirectPath(currentLocation, '/login')

  const redirectToLogin = (message = '로그인 후 이용해주세요.') => {
    toast.error(message)
    router.push(loginHref)
  }

  return {
    loginHref,
    redirectToLogin,
  }
}
