import 'server-only'

import {
  listCompletedMarketPurchasesForItem,
  listMarketV2EntitlementsForItem,
} from '@/lib/market-items-server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { DEFAULT_WORKSPACE_SUBJECT, type WorkspaceSubject } from '@/lib/workspace-subject'

export type MarketReviewSort = 'latest' | 'helpful'

export interface MarketReviewTagView {
  id: string
  label: string
}

export interface MarketItemReviewView {
  id: string
  rating: number
  content: string | null
  tagLabels: string[]
  tagIds: string[]
  helpfulCount: number
  votedByViewer: boolean
  isMine: boolean
  createdAt: string
  author: {
    name: string
    role: string | null
    avatarUrl: string | null
  }
}

export interface MarketItemReviewsResult {
  summary: { average: number | null; count: number }
  reviews: MarketItemReviewView[]
  activeTags: MarketReviewTagView[]
  viewer: {
    canWrite: boolean
    myReview: { id: string; rating: number; content: string | null; tagIds: string[] } | null
  }
}

const MAX_REVIEW_CONTENT_LENGTH = 1000
const MAX_REVIEW_TAGS = 8

function normalizeReviewContent(value?: string | null) {
  const normalized = (value ?? '').normalize('NFC').trim()
  if (!normalized) return null
  return normalized.slice(0, MAX_REVIEW_CONTENT_LENGTH)
}

async function isItemPurchaser(userId: string, itemId: string, workspaceSubject: WorkspaceSubject) {
  const [entitlements, purchases] = await Promise.all([
    listMarketV2EntitlementsForItem(userId, itemId, workspaceSubject),
    listCompletedMarketPurchasesForItem(userId, itemId, workspaceSubject),
  ])
  return entitlements.length > 0 || purchases.length > 0
}

export async function listMarketItemReviewsForItem(
  itemId: string,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT,
  options: { viewerId?: string | null; sort?: MarketReviewSort } = {}
): Promise<MarketItemReviewsResult> {
  const supabase = createAdminClient()
  const viewerId = options.viewerId ?? null
  const sort: MarketReviewSort = options.sort ?? 'latest'

  const [reviewsResult, tagsResult] = await Promise.all([
    supabase
      .from('market_item_reviews')
      .select('id, user_id, rating, content, tag_ids, created_at')
      .eq('item_id', itemId)
      .eq('workspace_subject', workspaceSubject)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    // 태그 맵은 해당 과목 한정, 비활성 포함(기존 후기 라벨 유지) — 미해석 id는 렌더에서 스킵
    supabase
      .from('market_review_tags')
      .select('id, label, sort_order, is_active')
      .eq('workspace_subject', workspaceSubject)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  if (reviewsResult.error) throw new Error(reviewsResult.error.message)
  if (tagsResult.error) throw new Error(tagsResult.error.message)

  const reviews = reviewsResult.data ?? []
  const tagLabelById = new Map((tagsResult.data ?? []).map((tag) => [tag.id, tag.label]))
  const activeTags = (tagsResult.data ?? [])
    .filter((tag) => tag.is_active)
    .map((tag) => ({ id: tag.id, label: tag.label }))

  const reviewIds = reviews.map((review) => review.id)
  const userIds = Array.from(new Set(reviews.map((review) => review.user_id)))

  const [votesResult, profilesResult, canWrite] = await Promise.all([
    reviewIds.length > 0
      ? supabase
        .from('market_item_review_votes')
        .select('review_id, user_id')
        .in('review_id', reviewIds)
      : Promise.resolve({ data: [], error: null } as const),
    userIds.length > 0
      // 민감정보 제외 — 명시적 select만 허용 (email/phone 등 절대 금지)
      ? supabase
        .from('profiles')
        .select('id, name, role, avatar_url')
        .in('id', userIds)
      : Promise.resolve({ data: [], error: null } as const),
    viewerId ? isItemPurchaser(viewerId, itemId, workspaceSubject) : Promise.resolve(false),
  ])

  if (votesResult.error) throw new Error(votesResult.error.message)
  if (profilesResult.error) throw new Error(profilesResult.error.message)

  const helpfulCountByReview = new Map<string, number>()
  const votedByViewerSet = new Set<string>()
  for (const vote of votesResult.data ?? []) {
    helpfulCountByReview.set(vote.review_id, (helpfulCountByReview.get(vote.review_id) ?? 0) + 1)
    if (viewerId && vote.user_id === viewerId) {
      votedByViewerSet.add(vote.review_id)
    }
  }

  const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]))

  const views: MarketItemReviewView[] = reviews.map((review) => {
    const profile = profileById.get(review.user_id)
    return {
      id: review.id,
      rating: review.rating,
      content: review.content,
      tagIds: review.tag_ids,
      tagLabels: review.tag_ids
        .map((tagId) => tagLabelById.get(tagId))
        .filter((label): label is string => Boolean(label)),
      helpfulCount: helpfulCountByReview.get(review.id) ?? 0,
      votedByViewer: votedByViewerSet.has(review.id),
      isMine: viewerId !== null && review.user_id === viewerId,
      createdAt: review.created_at,
      author: {
        name: profile?.name?.trim() || '구매자',
        role: profile?.role ?? null,
        avatarUrl: profile?.avatar_url ?? null,
      },
    }
  })

  if (sort === 'helpful') {
    views.sort((a, b) => b.helpfulCount - a.helpfulCount || b.createdAt.localeCompare(a.createdAt))
  }

  const count = views.length
  const average = count > 0
    ? views.reduce((total, review) => total + review.rating, 0) / count
    : null

  const mine = views.find((review) => review.isMine) ?? null

  return {
    summary: { average, count },
    reviews: views,
    activeTags,
    viewer: {
      canWrite,
      myReview: mine
        ? { id: mine.id, rating: mine.rating, content: mine.content, tagIds: mine.tagIds }
        : null,
    },
  }
}

export async function upsertMarketItemReview(input: {
  userId: string
  itemId: string
  workspaceSubject: WorkspaceSubject
  rating: number
  content?: string | null
  tagIds?: string[]
}): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const supabase = createAdminClient()
  const rating = Math.trunc(input.rating)
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return { ok: false, status: 422, message: '별점은 1~5점 사이여야 합니다.' }
  }

  const purchaser = await isItemPurchaser(input.userId, input.itemId, input.workspaceSubject)
  if (!purchaser) {
    return { ok: false, status: 403, message: '구매한 자료에만 후기를 작성할 수 있습니다.' }
  }

  // 태그 위조·타 과목 주입 방어: 해당 과목의 활성 태그만 통과
  const { data: activeTags, error: tagsError } = await supabase
    .from('market_review_tags')
    .select('id')
    .eq('workspace_subject', input.workspaceSubject)
    .eq('is_active', true)
  if (tagsError) return { ok: false, status: 500, message: tagsError.message }
  const activeTagIds = new Set((activeTags ?? []).map((tag) => tag.id))
  const tagIds = Array.from(new Set(input.tagIds ?? []))
    .filter((tagId) => activeTagIds.has(tagId))
    .slice(0, MAX_REVIEW_TAGS)

  const content = normalizeReviewContent(input.content)

  const { data: existing, error: existingError } = await supabase
    .from('market_item_reviews')
    .select('id')
    .eq('user_id', input.userId)
    .eq('item_id', input.itemId)
    .is('deleted_at', null)
    .maybeSingle()
  if (existingError) return { ok: false, status: 500, message: existingError.message }

  if (existing) {
    const { error } = await supabase
      .from('market_item_reviews')
      .update({ rating, content, tag_ids: tagIds })
      .eq('id', existing.id)
    if (error) return { ok: false, status: 500, message: error.message }
    return { ok: true }
  }

  const { error: insertError } = await supabase
    .from('market_item_reviews')
    .insert({
      user_id: input.userId,
      item_id: input.itemId,
      workspace_subject: input.workspaceSubject,
      rating,
      content,
      tag_ids: tagIds,
    })

  if (insertError) {
    // 동시 작성 경합(부분 유니크 23505): 재조회 후 update 폴백
    if (insertError.code === '23505') {
      const { data: raced } = await supabase
        .from('market_item_reviews')
        .select('id')
        .eq('user_id', input.userId)
        .eq('item_id', input.itemId)
        .is('deleted_at', null)
        .maybeSingle()
      if (raced) {
        const { error } = await supabase
          .from('market_item_reviews')
          .update({ rating, content, tag_ids: tagIds })
          .eq('id', raced.id)
        if (error) return { ok: false, status: 500, message: error.message }
        return { ok: true }
      }
    }
    return { ok: false, status: 500, message: insertError.message }
  }

  return { ok: true }
}

export async function softDeleteMarketItemReview(userId: string, reviewId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_item_reviews')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', reviewId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .select('id')
  if (error) return { ok: false as const, status: 500, message: error.message }
  if (!data?.length) return { ok: false as const, status: 404, message: '삭제할 후기를 찾을 수 없습니다.' }
  return { ok: true as const }
}

export async function toggleMarketItemReviewVote(userId: string, reviewId: string) {
  const supabase = createAdminClient()
  const { data: review, error: reviewError } = await supabase
    .from('market_item_reviews')
    .select('id, user_id')
    .eq('id', reviewId)
    .is('deleted_at', null)
    .maybeSingle()
  if (reviewError) return { ok: false as const, status: 500, message: reviewError.message }
  if (!review) return { ok: false as const, status: 404, message: '후기를 찾을 수 없습니다.' }
  if (review.user_id === userId) {
    return { ok: false as const, status: 403, message: '본인 후기에는 투표할 수 없습니다.' }
  }

  const { data: existing } = await supabase
    .from('market_item_review_votes')
    .select('id')
    .eq('review_id', reviewId)
    .eq('user_id', userId)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase.from('market_item_review_votes').delete().eq('id', existing.id)
    if (error) return { ok: false as const, status: 500, message: error.message }
  } else {
    const { error } = await supabase
      .from('market_item_review_votes')
      .insert({ review_id: reviewId, user_id: userId })
    // 동시 더블탭 23505는 '이미 투표됨'으로 멱등 처리
    if (error && error.code !== '23505') {
      return { ok: false as const, status: 500, message: error.message }
    }
  }

  const { count } = await supabase
    .from('market_item_review_votes')
    .select('id', { count: 'exact', head: true })
    .eq('review_id', reviewId)

  return { ok: true as const, voted: !existing, count: count ?? 0 }
}

// ── 어드민 ──────────────────────────────────────────────────────────

export interface AdminMarketReviewRow {
  id: string
  itemId: string
  itemTitle: string
  workspaceSubject: WorkspaceSubject
  rating: number
  content: string | null
  tagLabels: string[]
  helpfulCount: number
  authorName: string
  createdAt: string
}

export async function listMarketReviewsForAdmin(options: {
  workspaceSubject?: WorkspaceSubject
  rating?: number
  search?: string
  page?: number
  pageSize?: number
} = {}): Promise<{ rows: AdminMarketReviewRow[]; totalCount: number; page: number; totalPages: number }> {
  const supabase = createAdminClient()
  const pageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : 20
  const requestedPage = Math.max(Math.trunc(options.page ?? 1) || 1, 1)

  // or() 구문 파손·ilike 와일드카드 오작동 방지 후, 자료명 검색은 아이템 id 선조회로 처리
  const search = (options.search ?? '')
    .normalize('NFC')
    .trim()
    .replace(/[,()]/g, ' ')
    .replace(/[%_]/g, '\\$&')
    .trim()
  let searchOrFilter: string | null = null
  if (search) {
    let titleQuery = supabase
      .from('market_items')
      .select('id')
      .ilike('title', `%${search}%`)
      .limit(200)
    if (options.workspaceSubject) titleQuery = titleQuery.eq('workspace_subject', options.workspaceSubject)
    const { data: matchedItems } = await titleQuery
    const matchedItemIds = (matchedItems ?? []).map((item) => item.id)
    const orParts = [`content.ilike.%${search}%`]
    if (matchedItemIds.length > 0) {
      orParts.push(`item_id.in.(${matchedItemIds.join(',')})`)
    }
    searchOrFilter = orParts.join(',')
  }

  // 페이지가 총 페이지를 넘으면 range가 416으로 실패하므로, 카운트를 먼저 구해 클램프한다
  let countQuery = supabase
    .from('market_item_reviews')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
  if (options.workspaceSubject) countQuery = countQuery.eq('workspace_subject', options.workspaceSubject)
  if (options.rating) countQuery = countQuery.eq('rating', options.rating)
  if (searchOrFilter) countQuery = countQuery.or(searchOrFilter)
  const { count: totalCountRaw, error: countError } = await countQuery
  if (countError) throw new Error(countError.message)
  const totalCount = totalCountRaw ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const page = Math.min(requestedPage, totalPages)

  let dataQuery = supabase
    .from('market_item_reviews')
    .select('id, item_id, workspace_subject, user_id, rating, content, tag_ids, created_at, market_items!inner(title)')
    .is('deleted_at', null)
  if (options.workspaceSubject) dataQuery = dataQuery.eq('workspace_subject', options.workspaceSubject)
  if (options.rating) dataQuery = dataQuery.eq('rating', options.rating)
  if (searchOrFilter) dataQuery = dataQuery.or(searchOrFilter)

  const from = (page - 1) * pageSize
  const { data, error } = await dataQuery
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)
  if (error) throw new Error(error.message)

  const rows = data ?? []
  const userIds = Array.from(new Set(rows.map((row) => row.user_id)))
  const reviewIds = rows.map((row) => row.id)
  const tagIds = Array.from(new Set(rows.flatMap((row) => row.tag_ids)))

  const [profilesResult, votesResult, tagsResult] = await Promise.all([
    userIds.length > 0
      ? supabase.from('profiles').select('id, name').in('id', userIds)
      : Promise.resolve({ data: [], error: null } as const),
    reviewIds.length > 0
      ? supabase.from('market_item_review_votes').select('review_id').in('review_id', reviewIds)
      : Promise.resolve({ data: [], error: null } as const),
    tagIds.length > 0
      ? supabase.from('market_review_tags').select('id, label').in('id', tagIds)
      : Promise.resolve({ data: [], error: null } as const),
  ])

  const nameById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.name]))
  const voteCounts = new Map<string, number>()
  for (const vote of votesResult.data ?? []) {
    voteCounts.set(vote.review_id, (voteCounts.get(vote.review_id) ?? 0) + 1)
  }
  const tagLabelById = new Map((tagsResult.data ?? []).map((tag) => [tag.id, tag.label]))

  return {
    rows: rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      itemTitle: (row.market_items as { title: string } | null)?.title ?? '삭제된 자료',
      workspaceSubject: row.workspace_subject === 'korean' ? 'korean' : 'english',
      rating: row.rating,
      content: row.content,
      tagLabels: row.tag_ids.map((tagId) => tagLabelById.get(tagId)).filter((label): label is string => Boolean(label)),
      helpfulCount: voteCounts.get(row.id) ?? 0,
      authorName: nameById.get(row.user_id)?.trim() || '구매자',
      createdAt: row.created_at,
    })),
    totalCount,
    page,
    totalPages,
  }
}

export async function adminSoftDeleteMarketReview(reviewId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_item_reviews')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', reviewId)
    .is('deleted_at', null)
    .select('id')
  if (error) return { ok: false as const, message: error.message }
  if (!data?.length) return { ok: false as const, message: '삭제할 후기를 찾을 수 없습니다.' }
  return { ok: true as const }
}

export interface AdminMarketReviewTagRow {
  id: string
  workspaceSubject: WorkspaceSubject
  label: string
  sortOrder: number
  isActive: boolean
}

export async function listMarketReviewTagsForAdmin(
  workspaceSubject: WorkspaceSubject
): Promise<AdminMarketReviewTagRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_review_tags')
    .select('id, workspace_subject, label, sort_order, is_active')
    .eq('workspace_subject', workspaceSubject)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((tag) => ({
    id: tag.id,
    workspaceSubject: tag.workspace_subject === 'korean' ? 'korean' : 'english',
    label: tag.label,
    sortOrder: tag.sort_order,
    isActive: tag.is_active,
  }))
}

export async function createMarketReviewTag(input: {
  workspaceSubject: WorkspaceSubject
  label: string
  sortOrder?: number
}) {
  const supabase = createAdminClient()
  const label = input.label.normalize('NFC').trim()
  if (!label) return { ok: false as const, message: '태그 문구를 입력하세요.' }
  const { error } = await supabase.from('market_review_tags').insert({
    workspace_subject: input.workspaceSubject,
    label,
    sort_order: Math.trunc(input.sortOrder ?? 0) || 0,
  })
  if (error) return { ok: false as const, message: error.message }
  return { ok: true as const }
}

export async function updateMarketReviewTag(input: {
  tagId: string
  label?: string
  sortOrder?: number
  isActive?: boolean
}) {
  const supabase = createAdminClient()
  const updates: Record<string, unknown> = {}
  if (input.label !== undefined) {
    const label = input.label.normalize('NFC').trim()
    if (!label) return { ok: false as const, message: '태그 문구를 입력하세요.' }
    updates.label = label
  }
  if (input.sortOrder !== undefined) updates.sort_order = Math.trunc(input.sortOrder) || 0
  if (input.isActive !== undefined) updates.is_active = input.isActive
  if (Object.keys(updates).length === 0) return { ok: true as const }

  const { data, error } = await supabase
    .from('market_review_tags')
    .update(updates)
    .eq('id', input.tagId)
    .select('id')
  if (error) return { ok: false as const, message: error.message }
  if (!data?.length) return { ok: false as const, message: '태그를 찾을 수 없습니다.' }
  return { ok: true as const }
}
