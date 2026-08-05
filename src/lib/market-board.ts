import type { WorkspaceSubject } from '@/lib/workspace-subject'

export const MARKET_BOARD_DEFAULT_PAGE_SIZE = 10
export const MARKET_BOARD_MAX_PAGE_SIZE = 50

export type MarketBoardSort = 'latest' | 'views' | 'questions'
export type MarketBoardSourceFieldKey = 'source1' | 'source2' | 'source3' | 'source4'

export interface MarketBoardQuery {
  subject: WorkspaceSubject
  slug: string
  search?: string
  examYear?: number
  examMonth?: number
  gradeLevel?: string
  sourceType?: string
  source1?: string
  source2?: string
  source3?: string
  source4?: string
  sort?: MarketBoardSort
  page?: number
  pageSize?: number
}

export interface MarketBoardCategoryEntry {
  id: string
  slug: string
  title: string
  description: string | null
  itemCount: number
}

export interface MarketBoardCategoryGroup {
  id: string
  title: string
  isUngrouped: boolean
  entries: MarketBoardCategoryEntry[]
}

export interface MarketBoardSourceConfigField {
  key: MarketBoardSourceFieldKey
  label: string
  options: string[]
}

export interface MarketBoardSourceConfig {
  typeName: string
  fields: MarketBoardSourceConfigField[]
}

export interface MarketBoardRow {
  id: string
  title: string
  summary: string | null
  thumbnailUrl: string | null
  categoryTitle: string
  materialType: string | null
  sourceFields: Array<{ label: string; value: string }>
  examYear: number | null
  examMonth: number | null
  gradeLevel: string | null
  questionCount: number | null
  sample: {
    available: boolean
    pageCount: number
  }
  fileTypeLabels: string[]
  viewCount: number
  publishedAt: string
}

export interface MarketBoardData {
  subject: WorkspaceSubject
  groups: MarketBoardCategoryGroup[]
  category: {
    id: string
    slug: string
    title: string
    description: string | null
    groupId: string | null
    groupTitle: string | null
  }
  total: number
  filters: {
    years: number[]
    months: number[]
    grades: string[]
    sourceConfigs: MarketBoardSourceConfig[]
  }
  rows: MarketBoardRow[]
  pagination: {
    page: number
    pageSize: number
    pageCount: number
  }
}

export type MarketBoardResult =
  | { status: 'ready'; data: MarketBoardData }
  | { status: 'not_found' }
  | { status: 'error'; message: string }
