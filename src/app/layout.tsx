import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'

export const metadata: Metadata = {
  title: '써머썬 연구소',
  description: '영어와 국어 워크스페이스를 지원하는 문제 생성 플랫폼',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ko">
      <body className="antialiased font-sans">
        {children}
        <Toaster />
      </body>
    </html>
  )
}
