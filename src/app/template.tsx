import { Suspense } from 'react'
import { LoginCompleteDialog } from '@/components/auth/login-complete-dialog'

// 전역 헤더·푸터는 그 크롬을 쓰는 화면의 layout이 그린다(components/layout/site-chrome).
// 여기서 그리면 자체 헤더를 쓰는 화면에서도 서버가 헤더를 만들고 버리게 된다.
export default function RootTemplate({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <LoginCompleteDialog />
      </Suspense>
    </>
  )
}
