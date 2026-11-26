import Link from 'next/link'
import { MEMBER_RESTRICTION_PAGE_PATH, MEMBER_SUSPENSION_FALLBACK_TEXTS } from '@/lib/member-suspension'
import { getMemberSuspensionPolicyCached } from '@/lib/member-suspension-policy-server'
import { isRequestMemberRestricted } from '@/lib/member-suspension-server'

// 12번 5-3: 이용 제한 회원에게 회원 틀 위쪽에 한 줄 안내(texts.bannerRestricted)와 안내 화면 링크를 보인다.
// 판정은 미들웨어가 붙인 요청 헤더로 한다(최선 노력 — 실제 강제는 서버 가드). 정책을 읽지 못하면 대체 문구(apiBlocked)를 쓴다.
export async function MemberRestrictionBanner() {
  if (!(await isRequestMemberRestricted())) return null
  const policy = await getMemberSuspensionPolicyCached()
  const text = policy?.texts.bannerRestricted ?? MEMBER_SUSPENSION_FALLBACK_TEXTS.apiBlocked

  return (
    <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
        <span>{text}</span>
        <Link
          href={MEMBER_RESTRICTION_PAGE_PATH}
          className="font-semibold underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
        >
          자세히 보기
        </Link>
      </div>
    </div>
  )
}
