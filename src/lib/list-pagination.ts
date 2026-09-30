export const LIST_PAGE_SIZES = [20, 50] as const
export const DEFAULT_LIST_PAGE_SIZE = 20

export function normalizeListPage(value: unknown) {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

export function normalizeListPageSize(value: unknown) {
  return Number(value) === 50 ? 50 : DEFAULT_LIST_PAGE_SIZE
}

export function getListPagination(totalCount: number, requestedPage: unknown, requestedSize: unknown) {
  const pageSize = normalizeListPageSize(requestedSize)
  const totalPages = Math.ceil(totalCount / pageSize)
  const page = Math.min(normalizeListPage(requestedPage), Math.max(1, totalPages))
  return { totalCount, page, pageSize, totalPages, offset: (page - 1) * pageSize }
}

export function updateListQuery(query: string, changes: Record<string, string | number | null>) {
  const params = new URLSearchParams(query)
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '' || ((key === 'page' || key.endsWith('_page')) && Number(value) === 1)) params.delete(key)
    else params.set(key, String(value))
  }
  return params.toString()
}
