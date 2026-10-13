import { unstable_cache } from 'next/cache'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

// 공개 샘플 이미지 서명 주소의 유효 시간. 여러 방문자가 같은 주소를 받아야 CDN·브라우저 캐시가 듣는다.
export const PUBLIC_SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS = 24 * 60 * 60
// 같은 서명 주소를 내주는 시간. 관리자가 샘플을 바꾸면 태그로 즉시 새로 만든다.
const PUBLIC_SAMPLE_PAGES_CACHE_SECONDS = 60 * 60
// 오래 쓰이지 않은 캐시가 만료가 가까운 주소를 내주지 않도록, 남은 시간이 이보다 짧으면 새로 만든다.
const MIN_REMAINING_SIGNED_URL_MS = 2 * 60 * 60 * 1000

export function getMarketSamplePagesCacheTag(itemId: string) {
  return `market-sample-pages:${itemId}`
}

export async function getCachedPublicMarketSamplePages<T extends { expiresAt: string }>(
  itemId: string,
  workspaceSubject: WorkspaceSubject,
  build: (itemId: string, workspaceSubject: WorkspaceSubject) => Promise<T>
): Promise<T> {
  const cached = await unstable_cache(
    () => build(itemId, workspaceSubject),
    ['public-market-sample-pages', itemId, workspaceSubject],
    { revalidate: PUBLIC_SAMPLE_PAGES_CACHE_SECONDS, tags: [getMarketSamplePagesCacheTag(itemId)] }
  )()
  if (new Date(cached.expiresAt).getTime() - Date.now() > MIN_REMAINING_SIGNED_URL_MS) {
    return cached
  }
  return build(itemId, workspaceSubject)
}
