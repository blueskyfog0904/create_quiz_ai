import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { findCategoryPath } from '@/lib/market-category-tree'
import { getCachedCategoryNodes } from '@/lib/market-category-tree-cache'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// page는 loading.tsx 경계 안에서 스트리밍되어 거기서 부른 notFound()는 HTTP 200이 된다.
// 칸 존재 확인은 경계 밖인 layout에서 해 실제 HTTP 404를 보낸다(캐시 적중이면 쿼리 없음).
// 칸 id는 과목 사이에 겹치지 않으므로 두 과목 트리를 모두 본다.
export default async function CategoryLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!UUID_PATTERN.test(id)) {
    notFound()
  }
  const nodes = await getCachedCategoryNodes()
  if (!findCategoryPath(nodes.korean, id) && !findCategoryPath(nodes.english, id)) {
    notFound()
  }

  return children
}
