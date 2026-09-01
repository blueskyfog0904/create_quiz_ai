import { redirect } from 'next/navigation'

export default function MyPageWithdrawRedirect() {
  redirect('/legacy/mypage/withdraw')
}
