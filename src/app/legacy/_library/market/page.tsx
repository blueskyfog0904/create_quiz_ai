import { requireAuth } from '@/lib/auth'
import { resolveWorkspaceSubject } from '@/lib/workspace-subject'
import { listMarketLibraryRowsForUser } from '@/lib/market-items-server'
import MarketLibraryClient from './market-library-client'

interface MarketLibraryPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function MarketLibraryPage({ searchParams }: MarketLibraryPageProps) {
  const user = await requireAuth()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveWorkspaceSubject(resolvedSearchParams?.subject)
  const rows = await listMarketLibraryRowsForUser(user.id, workspaceSubject)
  // 예전 게시판 목록 대신 과목 홈으로 보낸다(S4-5).
  const browseMarketHref = `/?subject=${workspaceSubject}`

  return (
    <MarketLibraryClient
      rows={rows}
      workspaceSubject={workspaceSubject}
      browseMarketHref={browseMarketHref}
    />
  )
}
