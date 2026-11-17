import { escapeIlike } from '@/lib/admin-orders'

// 관리자 '문의 관리' 검색 조건(PostgREST .or()에 넣는 문자열). 서버·테스트가 같이 쓰는 순수 함수만 둔다.

// 검색어 한 칸: 제목·내용 부분 일치 + 이메일이 맞는 회원의 문의.
// 값을 큰따옴표로 감싸야 검색어의 쉼표·괄호·점이 필터 구문으로 읽히지 않는다. 따옴표 안에서는 \ 와 " 만 \ 로 막는다.
// *는 PostgREST가 와일드카드로 바꾸므로 뺀다(이메일 검색과 같게).
export function buildSupportTicketSearchFilter(keyword: string, matchedUserIds: string[]) {
  const pattern = `"%${escapeIlike(keyword.replaceAll('*', '')).replace(/[\\"]/g, '\\$&')}%"`
  const conditions = [`subject.ilike.${pattern}`, `message.ilike.${pattern}`]
  if (matchedUserIds.length > 0) conditions.push(`user_id.in.(${matchedUserIds.join(',')})`)
  return conditions.join(',')
}
