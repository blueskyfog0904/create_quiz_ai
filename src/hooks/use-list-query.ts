'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { normalizeListPage, normalizeListPageSize, updateListQuery } from '@/lib/list-pagination'

// 이미 내려받은 소유 자료/관리자 목록도 URL로 이동 상태를 복원한다.
export function useListQuery(prefix = '') {
  const pathname = usePathname()
  const params = useSearchParams()
  const pageKey = `${prefix}page`
  const sizeKey = `${prefix}pageSize`
  function update(changes: Record<string, string | number | null>, replace = false) {
    const query = updateListQuery(window.location.search, changes)
    if (query === new URLSearchParams(window.location.search).toString()) return
    window.history[replace ? 'replaceState' : 'pushState'](null, '', `${pathname}${query ? `?${query}` : ''}`)
  }
  return {
    params,
    page: normalizeListPage(params.get(pageKey)),
    pageSize: normalizeListPageSize(params.get(sizeKey)),
    setPage: (page: number) => update({ [pageKey]: page }),
    setPageSize: (size: number) => update({ [sizeKey]: size, [pageKey]: 1 }),
    update,
  }
}
