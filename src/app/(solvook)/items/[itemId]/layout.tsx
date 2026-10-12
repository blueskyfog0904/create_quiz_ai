import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// page는 loading.tsx 경계 안에서 스트리밍되어 거기서 부른 notFound()는 HTTP 200이 된다.
// id 형식 검사는 경계 밖인 layout에서 해 실제 HTTP 404를 보낸다(DB 조회 없음).
export default async function MarketItemDetailLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ itemId: string }>
}) {
  const { itemId } = await params
  if (!UUID_PATTERN.test(itemId)) {
    notFound()
  }

  return children
}
