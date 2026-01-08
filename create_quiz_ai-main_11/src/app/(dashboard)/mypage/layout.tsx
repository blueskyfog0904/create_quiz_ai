import { requireAuth } from '@/lib/auth'
import Link from 'next/link'
import { 
  CreditCard, 
  Coins, 
  User, 
  History, 
  Monitor, 
  UserX, 
  HelpCircle 
} from 'lucide-react'

const menuItems = [
  { href: '/mypage/payments', label: '결제 내역', icon: CreditCard },
  { href: '/mypage/credits', label: '크레딧 관리', icon: Coins },
  { href: '/mypage/profile', label: '내정보 관리', icon: User },
  { href: '/mypage/history', label: '생성/구매 히스토리', icon: History },
  { href: '/mypage/devices', label: '로그인 기기 관리', icon: Monitor },
  { href: '/mypage/withdraw', label: '회원 탈퇴', icon: UserX },
  { href: '/mypage/support', label: '고객지원', icon: HelpCircle },
]

export default async function MyPageLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireAuth()

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">마이페이지</h1>
        <p className="text-gray-500">계정 설정 및 활동 내역을 관리합니다.</p>
      </div>
      
      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar Navigation */}
        <aside className="w-full md:w-64 flex-shrink-0">
          <nav className="bg-white border rounded-lg p-4 space-y-1 sticky top-24">
            {menuItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 hover:bg-gray-100 hover:text-primary transition-colors"
              >
                <item.icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  )
}


