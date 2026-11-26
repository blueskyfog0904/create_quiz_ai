import 'server-only'

import { revalidateTag, unstable_cache } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  parseSupportPageContent,
  SUPPORT_PAGE_CONTENT_CACHE_TAG,
  SUPPORT_PAGE_CONTENT_SETTING_KEY,
  type SupportPageContent,
} from '@/lib/support-page-content'

// 13번 9절: 고객지원 문구는 서버 키로 이 설정 한 줄만 읽는다. 읽기 실패·형식 어긋남은 캐시하지 않고 예외로 올린다
// (회원 화면은 오류 화면, 답변 저장은 막음). 코드에 기본 문구가 없다.
const db = () => createAdminClient() as unknown as SupabaseClient

async function readContent(): Promise<{ status: 'ok'; content: SupportPageContent } | { status: 'missing' } | { status: 'invalid' }> {
  const { data, error } = await db().from('system_settings').select('value').eq('key', SUPPORT_PAGE_CONTENT_SETTING_KEY).maybeSingle()
  if (error) throw new Error(`고객지원 문구 조회 실패: ${error.code ?? ''}`)
  if (!data) return { status: 'missing' }
  const content = parseSupportPageContent((data as { value: unknown }).value)
  return content ? { status: 'ok', content } : { status: 'invalid' }
}

// unstable_cache 는 예외를 캐시하지 않는다(다음 요청이 다시 읽는다).
const readCachedContent = unstable_cache(async (): Promise<SupportPageContent> => {
  const result = await readContent()
  if (result.status !== 'ok') throw new Error(`고객지원 문구가 없거나 형식이 맞지 않습니다(${result.status}).`)
  return result.content
}, [SUPPORT_PAGE_CONTENT_SETTING_KEY], { tags: [SUPPORT_PAGE_CONTENT_CACHE_TAG] })

// 회원 화면·답변 route 가 쓴다. 읽지 못하면 예외.
export async function getSupportPageContent(): Promise<SupportPageContent> {
  return readCachedContent()
}

// 관리자 화면용: 캐시 없이 읽고, 없음·형식 어긋남·읽기 실패를 구분한다(실패를 빈 양식으로 보여 주면 덮어쓸 수 있다).
export async function readSupportPageContentForAdmin(): Promise<
  { status: 'ok'; content: SupportPageContent } | { status: 'missing' } | { status: 'invalid' } | { status: 'error' }
> {
  try {
    return await readContent()
  } catch (error) {
    console.error('[support-page-content] 관리자 화면에서 고객지원 문구를 읽지 못했습니다.', error)
    return { status: 'error' }
  }
}

// 저장(권한 검사·값 검사는 부르는 서버 액션이 한다). 지금 revision 과 같을 때만 바꾼다(동시 저장 충돌 → false).
export async function saveSupportPageContent(content: SupportPageContent, expectedRevision: number): Promise<boolean> {
  const { data, error } = await db()
    .from('system_settings')
    .update({ value: content, updated_at: new Date().toISOString() })
    .eq('key', SUPPORT_PAGE_CONTENT_SETTING_KEY)
    .eq('value->revision', expectedRevision)
    .select('key')
  if (error) throw new Error('고객지원 문구를 저장하지 못했습니다.')
  if (!data || data.length === 0) return false
  revalidateTag(SUPPORT_PAGE_CONTENT_CACHE_TAG, { expire: 0 })
  return true
}
