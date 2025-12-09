'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { 
  ChevronDown, 
  Menu, 
  User, 
  LogOut, 
  FolderOpen, 
  FileText, 
  CreditCard, 
  Coins, 
  History, 
  Monitor, 
  UserX, 
  HelpCircle,
  Sparkles,
  Library,
  BookOpen
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface HeaderClientProps {
  isLoggedIn: boolean
  userName: string
  isAdmin: boolean
  isMobile?: boolean
}

export function HeaderClient({ isLoggedIn, userName, isAdmin, isMobile = false }: HeaderClientProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  
  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  // Mobile Navigation
  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon">
            <Menu className="h-6 w-6" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-80">
          <SheetHeader>
            <SheetTitle>메뉴</SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-2 mt-6">
            {isLoggedIn ? (
              <>
                <Link href="/generate" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2">
                    <Sparkles className="h-4 w-4" />
                    AI문제생성
                  </Button>
                </Link>
                <Link href="/bank" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2">
                    <BookOpen className="h-4 w-4" />
                    문제은행
                  </Button>
                </Link>
                
                <div className="border-t my-2" />
                <p className="px-4 py-2 text-sm font-semibold text-gray-500">내 라이브러리</p>
                <Link href="/library/purchased" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                    <FolderOpen className="h-4 w-4" />
                    내가 구매한 문제
                  </Button>
                </Link>
                <Link href="/library/exam-papers" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                    <FileText className="h-4 w-4" />
                    문제지 관리
                  </Button>
                </Link>
                
                <div className="border-t my-2" />
                <p className="px-4 py-2 text-sm font-semibold text-gray-500">마이페이지</p>
                <Link href="/mypage/payments" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                    <CreditCard className="h-4 w-4" />
                    결제 내역
                  </Button>
                </Link>
                <Link href="/mypage/credits" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                    <Coins className="h-4 w-4" />
                    크레딧 관리
                  </Button>
                </Link>
                <Link href="/mypage/profile" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                    <User className="h-4 w-4" />
                    내정보 관리
                  </Button>
                </Link>
                <Link href="/mypage/history" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                    <History className="h-4 w-4" />
                    생성/구매 히스토리
                  </Button>
                </Link>
                <Link href="/mypage/devices" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                    <Monitor className="h-4 w-4" />
                    로그인 기기 관리
                  </Button>
                </Link>
                <Link href="/mypage/withdraw" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                    <UserX className="h-4 w-4" />
                    회원 탈퇴
                  </Button>
                </Link>
                <Link href="/mypage/support" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                    <HelpCircle className="h-4 w-4" />
                    고객지원
                  </Button>
                </Link>
                
                {isAdmin && (
                  <>
                    <div className="border-t my-2" />
                    <Link href="/admin" onClick={() => setIsOpen(false)}>
                      <Button variant="ghost" className="w-full justify-start gap-2 text-orange-600">
                        관리자
                      </Button>
                    </Link>
                  </>
                )}
                
                <div className="border-t my-2" />
                <div className="px-4 py-2 text-sm text-gray-600">{userName}</div>
                <Button 
                  variant="ghost" 
                  className="w-full justify-start gap-2 text-red-600"
                  onClick={() => {
                    setIsOpen(false)
                    handleLogout()
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  로그아웃
                </Button>
              </>
            ) : (
              <>
                <Link href="/login" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start">로그인</Button>
                </Link>
                <Link href="/signup" onClick={() => setIsOpen(false)}>
                  <Button className="w-full">회원가입</Button>
                </Link>
              </>
            )}
          </nav>
        </SheetContent>
      </Sheet>
    )
  }

  // Desktop Navigation - Dropdown Menus
  return (
    <>
      {/* 내 라이브러리 드롭다운 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="gap-1">
            <Library className="h-4 w-4" />
            내 라이브러리
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem asChild>
            <Link href="/library/purchased" className="flex items-center gap-2 cursor-pointer">
              <FolderOpen className="h-4 w-4" />
              내가 구매한 문제
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/library/exam-papers" className="flex items-center gap-2 cursor-pointer">
              <FileText className="h-4 w-4" />
              문제지 관리
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 마이페이지 드롭다운 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="gap-1">
            <User className="h-4 w-4" />
            마이페이지
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem asChild>
            <Link href="/mypage/payments" className="flex items-center gap-2 cursor-pointer">
              <CreditCard className="h-4 w-4" />
              결제 내역
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/mypage/credits" className="flex items-center gap-2 cursor-pointer">
              <Coins className="h-4 w-4" />
              크레딧 관리
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/mypage/profile" className="flex items-center gap-2 cursor-pointer">
              <User className="h-4 w-4" />
              내정보 관리
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/mypage/history" className="flex items-center gap-2 cursor-pointer">
              <History className="h-4 w-4" />
              생성/구매 히스토리
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/mypage/devices" className="flex items-center gap-2 cursor-pointer">
              <Monitor className="h-4 w-4" />
              로그인 기기 관리
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/mypage/withdraw" className="flex items-center gap-2 cursor-pointer">
              <UserX className="h-4 w-4" />
              회원 탈퇴
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/mypage/support" className="flex items-center gap-2 cursor-pointer">
              <HelpCircle className="h-4 w-4" />
              고객지원
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 관리자 링크 */}
      {isAdmin && (
        <Link href="/admin">
          <Button variant="ghost" className="text-orange-600 hover:text-orange-700 hover:bg-orange-50">
            관리자
          </Button>
        </Link>
      )}

      {/* 사용자 정보 및 로그아웃 */}
      <div className="flex items-center gap-3 ml-2 border-l pl-4">
        <span className="text-sm text-gray-600">{userName}</span>
        <Button 
          variant="ghost" 
          size="sm"
          onClick={handleLogout}
          className="text-gray-500 hover:text-red-600"
        >
          <LogOut className="h-4 w-4 mr-1" />
          로그아웃
        </Button>
      </div>
    </>
  )
}

