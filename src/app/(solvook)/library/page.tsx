import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { listMarketLibraryRowsForUser } from '@/lib/market-items-server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { LibraryView } from './_components/library-view'

export const metadata: Metadata = {
  title: '자료 보관함 | 써머썬 연구소',
  description: '구매한 수업 자료를 확인하고 다운로드하는 자료 보관함',
}

function resolveSubject(value?: string): WorkspaceSubject {
  return value === 'korean' ? 'korean' : 'english'
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>
}) {
  await connection()
  const params = await searchParams
  const subject = resolveSubject(params.subject)

  const userId = await getRequestAuthUserId()
  if (!userId) {
    const nextPath = subject === 'korean' ? '/library?subject=korean' : '/library'
    redirect(`/login?next=${encodeURIComponent(nextPath)}`)
  }

  const rows = await listMarketLibraryRowsForUser(userId, subject)

  return (
    <Suspense fallback={null}>
      <LibraryView key={subject} rows={rows} subject={subject} />
    </Suspense>
  )
}
