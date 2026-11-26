import 'server-only'

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { unstable_cache } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import { getListPagination } from '@/lib/list-pagination'
import {
  SITE_BOARD_CACHE_SECONDS,
  SITE_BOARD_CONTENT_CACHE_TAG,
  SITE_BOARD_CONTENT_SETTING_KEY,
  SITE_BOARD_POSTS_CACHE_TAG,
  extractSiteBoardError,
  isSiteBoardPostId,
  noticeIdFromPopupLink,
  parseSiteBoardContent,
  sortFaqPosts,
  sortNoticePosts,
  type SiteBoardAdminPost,
  type SiteBoardContent,
  type SiteBoardErrorCode,
  type SiteBoardKind,
  type SiteBoardPost,
  type SiteBoardPostInput,
  type SiteBoardRedactReasonCode,
} from '@/lib/site-board'
import { parseSiteNoticePopupValue, shouldServeNoticePopup, type SiteNoticePopupValue } from '@/lib/site-notice-popup'
import { readSiteNoticePopupForAdmin, readUpcomingPolicyDocumentsForAdmin } from '@/lib/site-notice-popup-server'
import type { AdminRequestMeta } from '@/lib/admin-request-meta'

// 14번 계획 6절: 공지·FAQ 서버 읽기(서버 키 + 캐시)와 DB 함수 호출. 표는 anon·authenticated 권한이 없어 세션 클라이언트로 읽지 않는다.
// 회원 읽기는 unstable_cache(60초 상한 + 태그)로 하고, 저장 뒤 revalidateTag(…, { expire: 0 }) 로 내린다. 기본 문구는 코드에 두지 않는다.

const POST_COLUMNS = 'id, board, title, body, link_url, link_label, faq_category_key, is_pinned, sort_order, is_published, published_at, content_updated_at'
const ADMIN_POST_COLUMNS = `${POST_COLUMNS}, revision, deleted_at, redacted_at, updated_at, updated_by`

interface PostRow {
  id: string
  board: SiteBoardKind
  title: string
  body: string
  link_url: string | null
  link_label: string | null
  faq_category_key: string | null
  is_pinned: boolean
  sort_order: number
  is_published: boolean
  published_at: string | null
  content_updated_at: string | null
}

interface AdminPostRow extends PostRow {
  revision: number
  deleted_at: string | null
  redacted_at: string | null
  updated_at: string
  updated_by: string | null
}

function toPost(row: PostRow): SiteBoardPost {
  return {
    id: row.id,
    board: row.board,
    title: row.title,
    body: row.body,
    linkUrl: row.link_url,
    linkLabel: row.link_label,
    faqCategoryKey: row.faq_category_key,
    isPinned: row.is_pinned,
    sortOrder: row.sort_order,
    isPublished: row.is_published,
    publishedAt: row.published_at,
    contentUpdatedAt: row.content_updated_at,
  }
}

function boardDb() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('site board: service key missing')
  }
  return createAdminClient() as unknown as SupabaseClient
}

// ── 10-2. 개발 전용 미리보기(운영 DB 를 읽거나 쓰지 않고 예시 글을 메모리에서 그린다) ──────────────────────────
// 켜는 법: `SITE_BOARD_PREVIEW=1 SITE_BOARD_PREVIEW_FILE=output/b14-site-board-preview.json npm run dev`
// 파일은 생성기(node supabase/scripts/bundle14_rehearsal/generate.mjs --preview)가 만든다. 미리보기에서는 저장 액션이 DB 를 부르지 않는다.
export function isSiteBoardPreviewEnabled() {
  return process.env.NODE_ENV === 'development'
    && !process.env.VERCEL
    && process.env.SITE_BOARD_PREVIEW === '1'
}

interface SiteBoardPreviewData {
  content: unknown
  posts: SiteBoardAdminPost[]
  popup: unknown
}

async function readPreviewData(): Promise<SiteBoardPreviewData | null> {
  const file = process.env.SITE_BOARD_PREVIEW_FILE
  if (!isSiteBoardPreviewEnabled() || !file) return null
  try {
    const parsed = JSON.parse(await readFile(resolve(process.cwd(), file), 'utf8')) as Partial<SiteBoardPreviewData>
    return { content: parsed.content ?? null, posts: Array.isArray(parsed.posts) ? parsed.posts : [], popup: parsed.popup ?? null }
  } catch {
    return null
  }
}

async function previewOr<T>(fromPreview: (data: SiteBoardPreviewData) => T, fromDb: () => Promise<T>): Promise<T> {
  if (isSiteBoardPreviewEnabled()) {
    const data = await readPreviewData()
    if (!data) throw new Error('site board preview file missing')
    return fromPreview(data)
  }
  return fromDb()
}

const previewPublished = (data: SiteBoardPreviewData, board: SiteBoardKind) =>
  data.posts.filter((post) => post.board === board && post.isPublished && !post.deletedAt && !post.redactedAt)

// ── 설정 행 ───────────────────────────────────────────────────────────────────────────────────────
async function readContentRow(): Promise<{ value: unknown; updatedAt: string | null }> {
  const { data, error } = await boardDb()
    .from('system_settings').select('value, updated_at').eq('key', SITE_BOARD_CONTENT_SETTING_KEY).maybeSingle()
  if (error) throw new Error(`site_board_content 읽기 실패: ${error.message}`)
  return { value: data?.value ?? null, updatedAt: typeof data?.updated_at === 'string' ? data.updated_at : null }
}

const getCachedContentValue = unstable_cache(
  async () => (await readContentRow()).value,
  ['site-board-content'],
  { revalidate: SITE_BOARD_CACHE_SECONDS, tags: [SITE_BOARD_CONTENT_CACHE_TAG] }
)

// 회원 화면 문구. 행이 없거나 필수 키가 비면 예외(오류 화면) — 기본 문구를 코드에 두지 않는다.
export async function getSiteBoardContent(): Promise<SiteBoardContent> {
  const raw = await previewOr((data) => data.content, () => getCachedContentValue())
  const content = parseSiteBoardContent(raw)
  if (!content) throw new Error('site_board_content missing or invalid')
  return content
}

// ── 회원 읽기(게시 글만) ────────────────────────────────────────────────────────────────────────────
export interface NoticePage {
  pinned: SiteBoardPost[]
  items: SiteBoardPost[]
  page: number
  totalPages: number
  totalCount: number
}

// 쪽 나눔은 비고정 게시 글 수로만 센다(쪽당 20개). 고정 글은 첫 쪽 위에 따로 붙고 쪽 수·offset 에 넣지 않는다(8절).
const getCachedNoticePage = unstable_cache(
  async (requestedPage: number): Promise<NoticePage> => {
    const db = boardDb()
    const { count, error: countError } = await db.from('site_board_posts')
      .select('id', { count: 'exact', head: true })
      .eq('board', 'notice').eq('is_published', true).is('deleted_at', null).eq('is_pinned', false)
    if (countError) throw new Error(`공지 수 읽기 실패: ${countError.message}`)
    const pagination = getListPagination(count ?? 0, requestedPage, null)
    const [pinned, items] = await Promise.all([
      pagination.page === 1
        ? db.from('site_board_posts').select(POST_COLUMNS)
            .eq('board', 'notice').eq('is_published', true).is('deleted_at', null).eq('is_pinned', true)
            .order('sort_order', { ascending: true }).order('id', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      db.from('site_board_posts').select(POST_COLUMNS)
        .eq('board', 'notice').eq('is_published', true).is('deleted_at', null).eq('is_pinned', false)
        .order('published_at', { ascending: false }).order('id', { ascending: true })
        .range(pagination.offset, pagination.offset + pagination.pageSize - 1),
    ])
    if (pinned.error || items.error) throw new Error('공지 목록 읽기 실패')
    return {
      pinned: ((pinned.data ?? []) as PostRow[]).map(toPost),
      items: ((items.data ?? []) as PostRow[]).map(toPost),
      page: pagination.page,
      totalPages: pagination.totalPages,
      totalCount: pagination.totalCount,
    }
  },
  ['site-board-notice-page'],
  { revalidate: SITE_BOARD_CACHE_SECONDS, tags: [SITE_BOARD_POSTS_CACHE_TAG] }
)

export async function getNoticePage(requestedPage: number): Promise<NoticePage> {
  return previewOr((data) => {
    const sorted = sortNoticePosts(previewPublished(data, 'notice'))
    const rest = sorted.filter((post) => !post.isPinned)
    const pagination = getListPagination(rest.length, requestedPage, null)
    return {
      pinned: pagination.page === 1 ? sorted.filter((post) => post.isPinned) : [],
      items: rest.slice(pagination.offset, pagination.offset + pagination.pageSize),
      page: pagination.page,
      totalPages: pagination.totalPages,
      totalCount: pagination.totalCount,
    }
  }, () => getCachedNoticePage(requestedPage))
}

const getCachedNotice = unstable_cache(
  async (id: string): Promise<SiteBoardPost | null> => {
    const { data, error } = await boardDb().from('site_board_posts').select(POST_COLUMNS)
      .eq('id', id).eq('board', 'notice').eq('is_published', true).is('deleted_at', null).maybeSingle()
    if (error) throw new Error(`공지 읽기 실패: ${error.message}`)
    return data ? toPost(data as PostRow) : null
  },
  ['site-board-notice'],
  { revalidate: SITE_BOARD_CACHE_SECONDS, tags: [SITE_BOARD_POSTS_CACHE_TAG] }
)

// 없는·숨김·삭제 글은 null(상세 화면 전용 not-found). id 가 uuid 모양이 아니면 바로 null.
export async function getNotice(id: string): Promise<SiteBoardPost | null> {
  if (!isSiteBoardPostId(id)) return null
  const normalized = id.toLowerCase()
  return previewOr(
    (data) => previewPublished(data, 'notice').find((post) => post.id === normalized) ?? null,
    () => getCachedNotice(normalized)
  )
}

// FAQ 는 쪽 나눔 없이 게시 글 전부를 읽는다(주소 #id 가 어느 분류·몇 번째든 펼쳐지게, 8절).
const getCachedPublishedFaqs = unstable_cache(
  async (): Promise<SiteBoardPost[]> => {
    const { data, error } = await boardDb().from('site_board_posts').select(POST_COLUMNS)
      .eq('board', 'faq').eq('is_published', true).is('deleted_at', null)
      .order('sort_order', { ascending: true }).order('id', { ascending: true })
    if (error) throw new Error(`FAQ 읽기 실패: ${error.message}`)
    return ((data ?? []) as PostRow[]).map(toPost)
  },
  ['site-board-faqs'],
  { revalidate: SITE_BOARD_CACHE_SECONDS, tags: [SITE_BOARD_POSTS_CACHE_TAG] }
)

export async function getAllPublishedFaqs(categories: SiteBoardContent['faq']['categories']): Promise<SiteBoardPost[]> {
  const posts = await previewOr((data) => previewPublished(data, 'faq'), () => getCachedPublishedFaqs())
  return sortFaqPosts(posts, categories)
}

const getCachedLinkAvailability = unstable_cache(
  async (): Promise<Record<SiteBoardKind, boolean>> => {
    const { data, error } = await boardDb().from('site_board_posts').select('board')
      .eq('is_published', true).is('deleted_at', null)
    if (error) throw new Error(`게시 글 여부 읽기 실패: ${error.message}`)
    const boards = new Set(((data ?? []) as { board: string }[]).map((row) => row.board))
    return { notice: boards.has('notice'), faq: boards.has('faq') }
  },
  ['site-board-link-availability'],
  { revalidate: SITE_BOARD_CACHE_SECONDS, tags: [SITE_BOARD_POSTS_CACHE_TAG] }
)

// 종류별 게시 글 있음 여부(하단·고객지원 링크는 게시 글이 1개 이상일 때만 보인다 — Q4).
export async function getBoardLinkAvailability(): Promise<Record<SiteBoardKind, boolean>> {
  return previewOr(
    (data) => ({ notice: previewPublished(data, 'notice').length > 0, faq: previewPublished(data, 'faq').length > 0 }),
    () => getCachedLinkAvailability()
  )
}

// 하단·고객지원 링크. 읽기 실패면 빈 목록(하단은 그대로 그린다).
export interface SiteBoardLinks {
  navLabel: string
  links: { key: SiteBoardKind; label: string; href: string }[]
}

export async function getSiteBoardLinks(): Promise<SiteBoardLinks | null> {
  try {
    const [content, available] = await Promise.all([getSiteBoardContent(), getBoardLinkAvailability()])
    const links: SiteBoardLinks['links'] = []
    if (available.notice) links.push({ key: 'notice', label: content.notice.footerLinkLabel, href: '/notices' })
    if (available.faq) links.push({ key: 'faq', label: content.faq.footerLinkLabel, href: '/faq' })
    return { navLabel: content.footer.navLabel, links }
  } catch (error) {
    console.error('[site-board] 링크 읽기 실패', error instanceof Error ? error.message : error)
    return null
  }
}

// ── 관리자 읽기(캐시 없음) ────────────────────────────────────────────────────────────────────────
export interface SiteBoardAdminData {
  board: SiteBoardKind
  content: SiteBoardContent
  contentUpdatedAt: string | null
  posts: SiteBoardAdminPost[]
  deletedPosts: SiteBoardAdminPost[]
  // 지금 켜진 공지 팝업(시작 전 예약 포함)이 가리키는 공지 id(7-3). 없으면 null.
  popupLinkedPostId: string | null
  // 공지 팝업 설정을 읽지 못함('연결 없음'과 구별 — 숨김·삭제 확인 창에 '확인하지 못했습니다' 경고)
  popupCheckFailed: boolean
  // 약관 변경 고지 기간(변경 예정 글 upcoming)이면 true — [주소 복사] 안내를 경고 색으로
  noticePeriod: boolean
  preview: boolean
}

function popupLinkedId(popup: SiteNoticePopupValue | null, nowMs: number) {
  return popup && shouldServeNoticePopup(popup, nowMs) ? noticeIdFromPopupLink(popup.linkUrl) : null
}

export async function readSiteBoardAdminData(board: SiteBoardKind, nowMs: number): Promise<SiteBoardAdminData> {
  const preview = isSiteBoardPreviewEnabled() ? await readPreviewData() : null
  if (isSiteBoardPreviewEnabled()) {
    if (!preview) throw new Error('site board preview file missing')
    const content = parseSiteBoardContent(preview.content)
    if (!content) throw new Error('site board preview content invalid')
    const all = preview.posts.filter((post) => post.board === board)
    const upcoming = await readUpcomingPolicyDocumentsForAdmin()
    return {
      board,
      content,
      contentUpdatedAt: null,
      posts: all.filter((post) => !post.deletedAt),
      deletedPosts: all.filter((post) => Boolean(post.deletedAt)),
      popupLinkedPostId: popupLinkedId(parseSiteNoticePopupValue(preview.popup), nowMs),
      popupCheckFailed: parseSiteNoticePopupValue(preview.popup) === null,
      noticePeriod: upcoming.ok && upcoming.value?.status === 'upcoming',
      preview: true,
    }
  }

  const db = boardDb()
  const [contentRow, postsResult, popupRow, upcoming] = await Promise.all([
    readContentRow(),
    db.from('site_board_posts').select(ADMIN_POST_COLUMNS).eq('board', board)
      .order('deleted_at', { ascending: true, nullsFirst: true }).order('is_pinned', { ascending: false })
      .order('sort_order', { ascending: true }).order('published_at', { ascending: false, nullsFirst: true }).order('id', { ascending: true }),
    readSiteNoticePopupForAdmin(),
    readUpcomingPolicyDocumentsForAdmin(),
  ])
  const content = parseSiteBoardContent(contentRow.value)
  if (!content) throw new Error('site_board_content missing or invalid')
  if (postsResult.error) throw new Error(`공지·FAQ 관리자 읽기 실패: ${postsResult.error.message}`)
  const rows = (postsResult.data ?? []) as AdminPostRow[]

  // 마지막 수정자(관리자 계정 이메일). 계정이 지워졌으면 id 앞부분만 보인다.
  const actorIds = [...new Set(rows.map((row) => row.updated_by).filter((id): id is string => Boolean(id)))]
  const emails = new Map<string, string>()
  if (actorIds.length > 0) {
    const { data } = await db.from('profiles').select('id, email').in('id', actorIds)
    for (const profile of (data ?? []) as { id: string; email: string | null }[]) {
      if (profile.email) emails.set(profile.id, profile.email)
    }
  }
  const toAdmin = (row: AdminPostRow): SiteBoardAdminPost => ({
    ...toPost(row),
    revision: row.revision,
    redactedAt: row.redacted_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    updatedByLabel: row.updated_by ? emails.get(row.updated_by) ?? row.updated_by.slice(0, 8) : null,
    deletedAt: row.deleted_at,
  })

  return {
    board,
    content,
    contentUpdatedAt: contentRow.updatedAt,
    posts: rows.filter((row) => !row.deleted_at).map(toAdmin),
    deletedPosts: rows.filter((row) => row.deleted_at).map(toAdmin),
    popupLinkedPostId: popupLinkedId(popupRow?.value ?? null, nowMs),
    // 15번 팝업 행은 운영에 있다 — 읽기 실패·형식 오류(null)는 '확인 못 함'으로 알린다.
    popupCheckFailed: popupRow === null,
    noticePeriod: upcoming.ok && upcoming.value?.status === 'upcoming',
    preview: false,
  }
}

// ── DB 함수 호출(서버 액션만 부른다) ─────────────────────────────────────────────────────────────────
export type SiteBoardCallResult =
  | { ok: true; changed: boolean; id: string | null; revision: number | null }
  | { ok: false; error: { code: SiteBoardErrorCode; detail: string | null } | null }

async function callRpc(name: string, args: Record<string, unknown>): Promise<SiteBoardCallResult> {
  const { data, error } = await boardDb().rpc(name, args)
  if (error) {
    const parsed = extractSiteBoardError(error.message)
    if (!parsed) console.error(`[site-board] ${name} 실패`, error.message)
    return { ok: false, error: parsed }
  }
  const result = (data ?? {}) as { changed?: unknown; id?: unknown; revision?: unknown }
  return {
    ok: true,
    changed: result.changed === true,
    id: typeof result.id === 'string' ? result.id : null,
    revision: typeof result.revision === 'number' ? result.revision : null,
  }
}

export function callSaveSiteBoardPost(actorId: string, board: SiteBoardKind, id: string | null, expectedRevision: number | null,
  input: SiteBoardPostInput, requestMeta: AdminRequestMeta) {
  return callRpc('save_site_board_post', {
    p_actor_id: actorId,
    p_id: id,
    p_expected_revision: expectedRevision,
    p_board: board,
    p_title: input.title,
    p_body: input.body,
    p_link_url: input.linkUrl,
    p_link_label: input.linkLabel,
    p_faq_category_key: input.faqCategoryKey,
    p_is_pinned: input.isPinned,
    p_is_published: input.isPublished,
    p_request_meta: requestMeta,
  })
}

export function callDeleteSiteBoardPost(actorId: string, id: string, expectedRevision: number, requestMeta: AdminRequestMeta) {
  return callRpc('delete_site_board_post', { p_actor_id: actorId, p_id: id, p_expected_revision: expectedRevision, p_request_meta: requestMeta })
}

export function callReorderSiteBoardPosts(actorId: string, board: SiteBoardKind, scope: string, ids: string[], requestMeta: AdminRequestMeta) {
  return callRpc('reorder_site_board_posts', { p_actor_id: actorId, p_board: board, p_scope: scope, p_ids: ids, p_request_meta: requestMeta })
}

export function callRedactSiteBoardPost(actorId: string, id: string, reasonCode: SiteBoardRedactReasonCode, requestMeta: AdminRequestMeta) {
  return callRpc('redact_site_board_post', { p_actor_id: actorId, p_id: id, p_reason_code: reasonCode, p_request_meta: requestMeta })
}

export function callSaveSiteBoardContent(actorId: string, expectedRevision: number, value: Omit<SiteBoardContent, 'revision'>, requestMeta: AdminRequestMeta) {
  return callRpc('save_site_board_content', { p_actor_id: actorId, p_expected_revision: expectedRevision, p_value: value, p_request_meta: requestMeta })
}

// 개인정보 판정의 예외 값(하단 정보 고객센터 연락처, DB 값). 관리자 편집 창의 TS 경고가 쓴다.
export async function readPiiAllowedContacts(): Promise<{ customerCenter: string; orderEmail: string }> {
  try {
    const { data } = await boardDb().from('system_settings').select('value').eq('key', 'site_footer_content').maybeSingle()
    const fixed = (data?.value as { fixedFields?: Record<string, { value?: unknown }> } | null)?.fixedFields
    return {
      customerCenter: typeof fixed?.customerCenter?.value === 'string' ? fixed.customerCenter.value : '',
      orderEmail: typeof fixed?.orderEmail?.value === 'string' ? fixed.orderEmail.value : '',
    }
  } catch {
    return { customerCenter: '', orderEmail: '' }
  }
}
