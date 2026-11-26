import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { MARKET_ITEM_OPTION_KINDS } from '@/lib/market-item-options'
import {
  isProductInfoPreviewEnabled,
  readMarketItemDisplayForAdmin,
  readMarketItemOptionsWithCounts,
} from '@/lib/market-item-options-server'
import { ProductSettingsAdmin } from './product-settings-admin'

interface ProductSettingsPageProps {
  searchParams?: Promise<{ subject?: string; tab?: string }>
}

// 17번 7-1: 상품 표시 설정(과목별 메뉴). 학년·자료유형·이용 근거(내부) 목록은 주소의 과목, 검색 필터 이름은 국어·영어 공통 1행.
// 쓰기는 관리자 route → DB 함수만(같은 거래에서 작업 기록). 읽기는 캐시 없이 서버 키로.
// 19번: 상세 안내 문구·자료 정보 항목(같은 공통 행의 detail 키)과 구성·파일 유형(과목별, 상품 편집에서 옮김) 탭. ?tab= 으로 처음 탭을 고른다.
export default async function ProductSettingsPage({ searchParams }: ProductSettingsPageProps) {
  await requireAdminPagePermission('products.edit')
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  const [lists, display] = await Promise.all([
    Promise.all(MARKET_ITEM_OPTION_KINDS.map(async (kind) => [kind, await readMarketItemOptionsWithCounts(workspaceSubject, kind)] as const)),
    readMarketItemDisplayForAdmin(),
  ])

  return (
    <ProductSettingsAdmin
      key={workspaceSubject}
      workspaceSubject={workspaceSubject}
      initialLists={Object.fromEntries(lists) as Parameters<typeof ProductSettingsAdmin>[0]['initialLists']}
      initialDisplay={display}
      preview={isProductInfoPreviewEnabled()}
      initialTab={resolvedSearchParams?.tab ?? ''}
    />
  )
}
