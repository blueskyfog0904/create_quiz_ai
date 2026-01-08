import { redirect } from 'next/navigation'

export default function MyPage() {
  // Redirect to profile page by default
  redirect('/mypage/profile')
}


