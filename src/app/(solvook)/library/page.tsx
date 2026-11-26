import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import {
  getMostRecentLibrarySubjectForUser,
  listMarketLibraryRowsForUser,
} from '@/lib/market-items-server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { DEFAULT_WORKSPACE_SUBJECT, type WorkspaceSubject } from '@/lib/workspace-subject'
import { LibraryView } from './_components/library-view'
import { getMarketPurchasePolicyView } from '@/lib/market-purchase-policy-server'
import { getMarketItemDisplay } from '@/lib/market-item-options-server'
import { fillLibraryEmptyFilterHint } from '@/lib/market-item-options'

export const metadata: Metadata = {
  title: '자료 보관함',
  description: '구매한 수업 자료를 확인하고 다운로드하는 자료 보관함',
}

// 명시된 과목만 그대로 쓰고, 없거나 알 수 없는 값이면 null(→ 최근 구매 과목으로 자동 결정)
function resolveExplicitSubject(value?: string): WorkspaceSubject | null {
  if (value === 'korean') return 'korean'
  if (value === 'english') return 'english'
  return null
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>
}) {
  await connection()
  const params = await searchParams
  const explicitSubject = resolveExplicitSubject(params.subject)

  const userId = await getRequestAuthUserId()
  if (!userId) {
    const nextPath = explicitSubject ? `/library?subject=${explicitSubject}` : '/library'
    redirect(`/login?next=${encodeURIComponent(nextPath)}`)
  }

  const subject =
    explicitSubject ??
    (await getMostRecentLibrarySubjectForUser(userId)) ??
    DEFAULT_WORKSPACE_SUBJECT

  // 17번: 필터 이름·빈 화면 안내(DB 상품 표시 설정). 자료와 함께 읽는다. 못 읽으면 이름·안내만 숨기고 필터 동작은 그대로 둔다.
  const displayPromise = getMarketItemDisplay().catch((error) => {
    console.error('[library] 필터 이름 읽기 실패', error instanceof Error ? error.message : error)
    return null
  })
  const [rows, purchasePolicy] = await Promise.all([
    listMarketLibraryRowsForUser(userId, subject),
    // 받지 않은 자료 환불 확인창 문구(DB). 못 읽으면 부분 환불 신청 버튼을 막는다.
    getMarketPurchasePolicyView(),
  ])
  const display = await displayPromise

  return (
    <Suspense fallback={null}>
      <LibraryView
        key={subject}
        rows={rows}
        subject={subject}
        partialRefundNotice={purchasePolicy?.partialRefundConfirmNotice ?? null}
        facetLabels={display?.facetLabels ?? null}
        emptyFilterHint={display ? fillLibraryEmptyFilterHint(display) : null}
      />
    </Suspense>
  )
}
