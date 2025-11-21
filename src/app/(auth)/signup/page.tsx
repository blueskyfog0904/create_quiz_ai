'use client'

import { useState } from 'react'
import { signup } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from 'sonner'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function SignupPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [successData, setSuccessData] = useState<{ email: string, name: string, phone: string } | null>(null)
  
  // Controlled inputs
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [phone, setPhone] = useState('')

  const router = useRouter()

  const formatPhoneNumber = (value: string) => {
    const cleaned = value.replace(/\D/g, '')
    
    if (cleaned.length <= 3) {
        return cleaned
    } else if (cleaned.length <= 7) {
        return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`
    } else {
        return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7, 11)}`
    }
  }

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value)
    setPhone(formatted)
  }

  async function handleSignup(formData: FormData) {
    const formPassword = formData.get('password') as string
    const formConfirmPassword = formData.get('confirmPassword') as string

    if (formPassword !== formConfirmPassword) {
      toast.error("비밀번호가 일치하지 않습니다.")
      return
    }

    // Ensure phone is passed correctly from state or form
    // FormData will pick up the value from the input which is controlled by state 'phone'
    // so it should be correct format.

    setIsLoading(true)
    try {
      const result = await signup(formData)
      
      if (result?.error) {
        toast.error(`회원가입 실패: ${result.error}`)
      } else if (result?.success && result.data) {
        setSuccessData({
            email: result.data.email || '',
            name: result.data.name,
            phone: result.data.phone
        })
        setIsSuccess(true)
        toast.success("회원가입이 완료되었습니다.")
      }
    } catch (e) {
      console.error(e)
      toast.error("알 수 없는 오류가 발생했습니다.")
    } finally {
      setIsLoading(false)
    }
  }

  if (isSuccess && successData) {
    return (
      <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-center text-green-600">회원가입 완료</CardTitle>
            <CardDescription className="text-center">
              회원가입이 성공적으로 완료되었습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                <div className="flex justify-between border-b pb-2">
                    <span className="text-gray-500">아이디(이메일)</span>
                    <span className="font-medium">{successData.email}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                    <span className="text-gray-500">이름</span>
                    <span className="font-medium">{successData.name}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-500">핸드폰</span>
                    <span className="font-medium">{successData.phone}</span>
                </div>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg space-y-2">
                <p className="text-sm font-semibold text-yellow-800 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                    </svg>
                    이메일 인증이 필요합니다
                </p>
                <p className="text-sm text-yellow-700">
                    <strong>{successData.email}</strong> 주소로 발송된 인증 메일을 확인해주세요.
                </p>
                <p className="text-xs text-yellow-600">
                    이메일 인증을 완료해야 로그인할 수 있습니다. 메일이 오지 않았다면 스팸함을 확인해주세요.
                </p>
            </div>
          </CardContent>
          <CardFooter>
            <Link href="/" className="w-full">
                <Button className="w-full">메인 페이지로 이동하기</Button>
            </Link>
          </CardFooter>
        </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">회원가입</CardTitle>
          <CardDescription className="text-center">
            서비스 이용을 위해 정보를 입력해주세요
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={handleSignup} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">이메일 (아이디) *</Label>
              <Input id="email" name="email" type="email" placeholder="name@example.com" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">비밀번호 *</Label>
              <Input 
                id="password" 
                name="password" 
                type="password" 
                required 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirmPassword">비밀번호 확인 *</Label>
              <Input 
                id="confirmPassword" 
                name="confirmPassword" 
                type="password" 
                required 
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {confirmPassword.length > 0 && (
                <p className={`text-xs ${password === confirmPassword ? 'text-green-600' : 'text-red-500'}`}>
                  {password === confirmPassword 
                    ? '비밀번호가 일치합니다.' 
                    : '비밀번호가 일치하지 않습니다. X'}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="name">이름 *</Label>
              <Input id="name" name="name" placeholder="홍길동" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">휴대폰 번호</Label>
              <Input 
                id="phone" 
                name="phone" 
                placeholder="010-1234-5678" 
                value={phone}
                onChange={handlePhoneChange}
                maxLength={13}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="birthdate">생년월일</Label>
              <Input id="birthdate" name="birthdate" type="date" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="organization">소속 (학교/학원)</Label>
              <Input id="organization" name="organization" placeholder="OOO 학교" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="gender">성별</Label>
              <Select name="gender">
                <SelectTrigger>
                  <SelectValue placeholder="선택해주세요" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">남성</SelectItem>
                  <SelectItem value="female">여성</SelectItem>
                  <SelectItem value="other">기타</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="address">주소</Label>
              <Input id="address" name="address" placeholder="서울특별시 강남구..." />
            </div>
            
            <Button className="w-full mt-4" type="submit" disabled={isLoading || (password !== confirmPassword)}>
              {isLoading ? '가입 처리 중...' : '가입하기'}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex justify-center">
            <div className="text-sm text-gray-500">
                이미 계정이 있으신가요? <Link href="/login" className="underline text-primary">로그인</Link>
            </div>
        </CardFooter>
      </Card>
  )
}
