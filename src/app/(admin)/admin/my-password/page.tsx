import { MyPasswordClient } from './my-password-client'
import { requireAdminPanelUser } from '@/lib/auth'

// 로그인한 관리자 본인의 비밀번호 변경(계획 4-1절). 관리자 계정 관리 화면은 대표 전용이라 일반 관리자는 여기서 바꾼다.
export default async function AdminMyPasswordPage() {
  await requireAdminPanelUser()

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 max-md:text-2xl">내 비밀번호 변경</h1>
        <p className="mt-1 text-gray-500">현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿉니다. 바꾸면 이 화면을 뺀 다른 기기·브라우저의 로그인은 끊깁니다.</p>
      </div>
      <MyPasswordClient />
    </div>
  )
}
