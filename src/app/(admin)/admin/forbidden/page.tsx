import Link from 'next/link'

export const metadata = { title: '권한 없음' }

// 권한이 없는 관리자 화면에 들어오면 requireAdminPagePermission이 여기로 보낸다.
export default function AdminForbiddenPage() {
  return (
    <div className="flex-1 space-y-4 p-8 pt-6 max-md:p-0">
      <h2 className="text-3xl font-bold tracking-tight max-md:text-2xl">권한 없음</h2>
      <p className="text-sm text-muted-foreground">
        이 화면을 볼 권한이 없습니다. 필요한 권한은 대표 관리자에게 요청해 주세요.
      </p>
      <Link href="/admin" className="text-sm font-medium underline">
        관리자 홈으로
      </Link>
    </div>
  )
}
