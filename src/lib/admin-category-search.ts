// 18번 7절(B-08): 상품 카테고리 한 줄 검색(순수). 트리를 '전체 경로' 목록으로 펴서, 띄어쓰기로 나눈 낱말이 모두 든 경로를 찾는다.
// 비활성 칸이거나 비활성 조상이 있으면 inactive. 결과는 최대 20개, 맨 끝 칸 이름에 든 낱말이 많을수록 앞, 같으면 트리 순서.

export interface CategorySearchNode {
  id: string
  title: string
  isActive: boolean
  children: CategorySearchNode[]
}

export interface CategoryPathEntry {
  id: string
  titles: string[]
  label: string
  inactive: boolean
  hasChildren: boolean
  order: number
}

export const CATEGORY_SEARCH_LIMIT = 20

export function normalizeCategorySearchText(text: string) {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function flattenCategoryPaths(nodes: CategorySearchNode[]): CategoryPathEntry[] {
  const entries: CategoryPathEntry[] = []
  const walk = (list: CategorySearchNode[], titles: string[], inactiveAncestor: boolean) => {
    for (const node of list) {
      const path = [...titles, node.title]
      const inactive = inactiveAncestor || !node.isActive
      entries.push({ id: node.id, titles: path, label: path.join(' > '), inactive, hasChildren: node.children.length > 0, order: entries.length })
      walk(node.children, path, inactive)
    }
  }
  walk(nodes, [], false)
  return entries
}

export function searchCategoryPaths(entries: CategoryPathEntry[], query: string, limit = CATEGORY_SEARCH_LIMIT): CategoryPathEntry[] {
  const terms = normalizeCategorySearchText(query).split(' ').filter(Boolean)
  if (terms.length === 0) return []
  const scored: { entry: CategoryPathEntry; score: number }[] = []
  for (const entry of entries) {
    const full = normalizeCategorySearchText(entry.titles.join(' '))
    if (!terms.every((term) => full.includes(term))) continue
    const leaf = normalizeCategorySearchText(entry.titles.at(-1) ?? '')
    scored.push({ entry, score: terms.filter((term) => leaf.includes(term)).length })
  }
  scored.sort((left, right) => right.score - left.score || left.entry.order - right.entry.order)
  return scored.slice(0, limit).map((item) => item.entry)
}

// 최근 고른 카테고리(브라우저 저장, 과목별 3개). 저장을 못 읽으면 빈 목록 — 칩 없이 동작한다.
export const RECENT_CATEGORY_LIMIT = 3

export function pushRecentCategory(current: string[], categoryId: string, limit = RECENT_CATEGORY_LIMIT) {
  return [categoryId, ...current.filter((id) => id !== categoryId)].slice(0, limit)
}

export function parseRecentCategories(raw: string | null, limit = RECENT_CATEGORY_LIMIT): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string').slice(0, limit) : []
  } catch {
    return []
  }
}
