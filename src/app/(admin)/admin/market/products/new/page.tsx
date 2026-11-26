import { hasAdminPermission } from '@/lib/admin-permissions'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { listMarketCategoryTreeForAdmin } from '@/lib/market-categories-server'
import { findCategoryPath } from '@/lib/market-category-tree'
import { listMarketItemsForAdmin } from '@/lib/market-items-server'
import { listMarketItemOptions } from '@/lib/market-item-options-server'
import MarketProductsClient from '../market-products-client'

interface AdminMarketProductNewPageProps {
  searchParams?: Promise<{ subject?: string; categoryId?: string }>
}

export default async function AdminMarketProductNewPage({ searchParams }: AdminMarketProductNewPageProps) {
  const access = await requireAdminPagePermission('products.edit')
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  const [categoryNodes, items, gradeOptions, materialTypeOptions] = await Promise.all([
    listMarketCategoryTreeForAdmin(workspaceSubject),
    listMarketItemsForAdmin({ workspaceSubject }),
    // 17번: 학년·자료유형 선택 목록(과목별 DB 목록)
    listMarketItemOptions(workspaceSubject, 'grade'),
    listMarketItemOptions(workspaceSubject, 'material_type'),
  ])

  // 18번: 관리 화면 저장 뒤 창 [빈 새 상품]이 넘긴 카테고리(이 과목 트리에 있는 칸만)
  const requestedCategoryId = resolvedSearchParams?.categoryId ?? ''
  const initialCategoryItemId = requestedCategoryId && findCategoryPath(categoryNodes, requestedCategoryId) ? requestedCategoryId : ''

  // 과목을 바꾸면 초기 트리·목록으로 다시 시작한다(클라이언트 상태가 이전 과목 값을 들고 있지 않게).
  return (
    <MarketProductsClient
      key={workspaceSubject}
      mode="create"
      initialCategoryNodes={categoryNodes}
      initialItems={items}
      workspaceSubject={workspaceSubject}
      canDeleteProducts={hasAdminPermission(access, 'products.delete')}
      attributeOptions={{ grade: gradeOptions, material_type: materialTypeOptions }}
      initialCategoryItemId={initialCategoryItemId}
    />
  )
}
