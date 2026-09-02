import type { Metadata } from 'next'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import {
  getMarketCategoryItemDetail,
  listMarketItemsForCategory,
} from '@/lib/market-categories-server'
import { CategoryItemsView } from './_components/category-items-view'

export const metadata: Metadata = {
  title: '카테고리 | 써머썬 연구소',
  description: '카테고리에 등록된 수업 자료를 확인합니다.',
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await connection()
  const { id } = await params

  const category = await getMarketCategoryItemDetail(id)
  if (!category) {
    notFound()
  }

  const rows = await listMarketItemsForCategory(id)

  return (
    <Suspense fallback={null}>
      <CategoryItemsView category={category} rows={rows} />
    </Suspense>
  )
}
