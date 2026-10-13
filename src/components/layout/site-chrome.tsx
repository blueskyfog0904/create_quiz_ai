import type { ReactNode } from 'react'
import { Header } from './header'
import { Footer } from './footer'

// 예전 전역 헤더·푸터. 이 크롬을 쓰는 화면의 layout에서만 그린다.
// (공개 마켓·로그인·관리자 화면은 자체 헤더를 쓰므로 서버가 이 헤더를 만들지 않게 한다)
export function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  )
}
