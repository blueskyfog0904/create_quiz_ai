import rawSampleData from './sample-data.json'

export type SampleSegmentLabel = 'A' | 'B' | 'C'
export type SampleCoverTheme = 'violet' | 'mint' | 'coral' | 'navy'

export interface SampleBoardFilters {
  years: string[]
  textbooks: string[]
  workTypes: string[]
  grades: string[]
}

export interface SampleBoard {
  slug: string
  title: string
  description: string
  filters: SampleBoardFilters
}

export interface SampleCover {
  eyebrow: string
  title: string
  subtitle: string
  theme: SampleCoverTheme
}

export interface SamplePassageSegment {
  label: SampleSegmentLabel
  title: string
  content: string[]
}

export interface SamplePassage {
  id: string
  title: string
  sourceNote: string
  segments: SamplePassageSegment[]
}

export interface SampleQuestion {
  id: string
  passageId: string
  segmentRefs: SampleSegmentLabel[]
  type: string
  prompt: string
  choices: string[]
  answer: string
  explanation: string
}

export interface SampleMaterialPost {
  id: string
  boardSlug: string
  title: string
  authorLabel: string
  summary: string
  year: string
  textbook: string
  workType: string
  grade: string
  viewCount: number
  publishedAt: string
  hasSample: boolean
  fileFormats: string[]
  cover: SampleCover
  passages: SamplePassage[]
  questions: SampleQuestion[]
}

export interface SampleFilterCase {
  id: 'positive-multi-filter' | 'zero-result-multi-filter'
  year: string
  textbook: string
  workType: string
  grade: string
}

export interface SampleData {
  boards: SampleBoard[]
  posts: SampleMaterialPost[]
  filterCases: SampleFilterCase[]
  pagination: {
    pageSizes: number[]
    defaultPageSize: number
  }
}

export interface SamplePostCounts {
  passageCount: number
  questionCount: number
}

export const sampleData = rawSampleData as SampleData
export const sampleBoards = sampleData.boards
export const samplePosts = sampleData.posts
export const samplePagination = sampleData.pagination

export function getSampleBoard(slug: string) {
  return sampleBoards.find((board) => board.slug === slug)
}

export function getSamplePostsByBoard(boardSlug: string) {
  return samplePosts.filter((post) => post.boardSlug === boardSlug)
}

export function getSamplePost(boardSlug: string, postId: string) {
  return samplePosts.find(
    (post) => post.boardSlug === boardSlug && post.id === postId
  )
}

export function getSamplePostCounts(
  post: SampleMaterialPost
): SamplePostCounts {
  return {
    passageCount: post.passages.length,
    questionCount: post.questions.length,
  }
}

export function getRecentSamplePosts(limit = 5) {
  return [...samplePosts]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit)
}

export function getSampleTextbookCounts() {
  return samplePosts.reduce<Record<string, number>>((counts, post) => {
    counts[post.textbook] = (counts[post.textbook] ?? 0) + 1
    return counts
  }, {})
}
