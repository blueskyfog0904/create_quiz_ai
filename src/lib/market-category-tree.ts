// 문제마켓 카테고리 트리(depth 1~5) 순수 함수. import가 없어 서버·클라이언트·테스트 어디서든 쓴다.

export const MARKET_CATEGORY_MAX_DEPTH = 5

export interface MarketCategoryNode {
  id: string
  title: string
  depth: number
  // 자기 칸 + 하위 칸 전체의 공개 상품 수(개수를 읽었을 때만 있음)
  itemCount?: number
  children: MarketCategoryNode[]
}

export type MarketCategoryTree = Record<'english' | 'korean', MarketCategoryNode[]>

export interface MarketCategoryNodeRow {
  id: string
  parent_id: string | null
  depth: number
  title: string
  sort_order: number
  created_at: string
  workspace_subject: string
}

// 행 목록을 과목별 트리로 조립한다. 부모가 목록에 없는 행(조상 중 비활성이 있는 칸)은 그 아래 전체가 빠진다.
export function buildCategoryTree(rows: MarketCategoryNodeRow[]): MarketCategoryTree {
  const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
  const nodes = new Map<string, MarketCategoryNode>()
  for (const row of sorted) {
    nodes.set(row.id, { id: row.id, title: row.title, depth: row.depth, children: [] })
  }

  const tree: MarketCategoryTree = { english: [], korean: [] }
  for (const row of sorted) {
    const node = nodes.get(row.id)!
    if (row.parent_id === null) {
      if (row.workspace_subject === 'english' || row.workspace_subject === 'korean') {
        tree[row.workspace_subject].push(node)
      }
      continue
    }
    nodes.get(row.parent_id)?.children.push(node)
  }
  return tree
}

// 칸별 직접 상품 수로 하위 합산 개수를 채운다(후위 순회).
export function applyCategoryItemCounts(nodes: MarketCategoryNode[], directCounts: Map<string, number>) {
  for (const node of nodes) {
    applyCategoryItemCounts(node.children, directCounts)
    node.itemCount = (directCounts.get(node.id) ?? 0)
      + node.children.reduce((sum, child) => sum + (child.itemCount ?? 0), 0)
  }
}

// maxDepth까지만 남긴 복사본. 개수는 잘라내기 전 하위 합산 값을 그대로 둔다.
export function toMegaMenuTree(tree: MarketCategoryTree, maxDepth = 2): MarketCategoryTree {
  const trim = (nodes: MarketCategoryNode[]): MarketCategoryNode[] => nodes.map((node) => ({
    ...node,
    children: node.depth < maxDepth ? trim(node.children) : [],
  }))
  return { english: trim(tree.english), korean: trim(tree.korean) }
}

// 조상 → 자신 순서의 경로. 없으면 null. 관리자 트리 노드처럼 필드가 더 있는 노드에도 쓴다.
export function findCategoryPath<T extends { id: string; children: T[] }>(nodes: T[], id: string): T[] | null {
  for (const node of nodes) {
    if (node.id === id) return [node]
    const path = findCategoryPath(node.children, id)
    if (path) return [node, ...path]
  }
  return null
}

// 자신과 하위 칸 전체의 id
export function collectSubtreeIds<T extends { id: string; children: T[] }>(node: T): string[] {
  return [node.id, ...node.children.flatMap(collectSubtreeIds)]
}
