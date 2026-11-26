// 관리자 요청의 IP·기기(계획 13번 8-1, 10번 14절 13번에서 옮김). 작업 기록 details.request 와 열람 기록 ip·user_agent 에 남는다.
// route 는 request 를, 서버 컴포넌트·서버 액션은 headers() 결과를 넘긴다.
export interface AdminRequestMeta {
  [key: string]: string | null
  ip: string | null
  user_agent: string | null
}

export function adminRequestMeta(source: Request | Headers): AdminRequestMeta {
  const headers = source instanceof Headers ? source : source.headers
  const forwarded = headers.get('x-forwarded-for')
  return {
    ip: forwarded?.split(',')[0]?.trim() || headers.get('x-real-ip') || null,
    user_agent: headers.get('user-agent')?.slice(0, 300) ?? null,
  }
}
