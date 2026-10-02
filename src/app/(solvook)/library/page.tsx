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

export const metadata: Metadata = {
  title: '자료 보관함 | 써머썬 연구소',
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

  const rows = await listMarketLibraryRowsForUser(userId, subject)

  return (
    <Suspense fallback={null}>
      <LibraryView key={subject} rows={rows} subject={subject} />
    </Suspense>
  )
}
