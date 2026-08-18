import type { MarketBoardCategoryGroup } from '@/lib/market-board'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { ProblemMarketMenu } from '../ProblemMarketMenu'

interface BoardCategorySidebarProps {
  groups: MarketBoardCategoryGroup[]
  categorySlug: string
  subject: WorkspaceSubject
  search: string
  year: string
  sort: string
}

function buildCategoryHref({
  slug,
  subject,
  search,
  year,
  sort,
}: {
  slug: string
  subject: WorkspaceSubject
  search: string
  year: string
  sort: string
}) {
  const pathname = `/preview/solvook-concept/boards/${slug}`
  const query = new URLSearchParams()

  query.set('subject', subject)

  if (search) query.set('search', search)
  if (year) query.set('year', year)
  if (sort === 'latest') query.set('sort', sort)

  return query.size > 0 ? `${pathname}?${query.toString()}` : `${pathname}?subject=${subject}`
}

export function BoardCategorySidebar({
  groups,
  categorySlug,
  subject,
  search,
  year,
  sort,
}: BoardCategorySidebarProps) {
  return (
    <ProblemMarketMenu
      subject={subject}
      entries={groups.flatMap((group) =>
        group.entries.map((entry) => ({
          id: entry.id,
          title: entry.title,
          href: buildCategoryHref({
            slug: entry.slug,
            subject,
            search,
            year,
            sort,
          }),
          isCurrent: entry.slug === categorySlug,
        }))
      )}
      className="mb-3 p-5 min-[1720px]:absolute min-[1720px]:left-6 min-[1720px]:top-0 min-[1720px]:-ml-3 min-[1720px]:w-56 min-[1720px]:-translate-x-full"
    />
  )
}
