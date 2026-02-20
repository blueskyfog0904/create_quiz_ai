'use client'

import { useEffect, useState } from 'react'
import { signup } from '../../auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type JsonObject = Record<string, unknown>

const isJsonObject = (value: unknown): value is JsonObject => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const getFirstText = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) {
        return trimmed
      }
      continue
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }

  return ''
}

const getFirstObject = (...values: unknown[]) => {
  for (const value of values) {
    if (isJsonObject(value)) {
      return value
    }
  }

  return null
}

const normalizeKakaoPhoneNumber = (value: string) => {
  if (!value) {
    return ''
  }

  const trimmed = value.replace(/\u00a0/g, ' ').trim()
  if (!trimmed.startsWith('+82')) {
    return trimmed
  }

  return trimmed.replace(/^\+82[\s-]?/, '0')
}

export default function SignupPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [isKakaoProfileLoading, setIsKakaoProfileLoading] = useState(false)
  const [isKakaoSignupCompleted, setIsKakaoSignupCompleted] = useState(false)
  const [isEmailSignupMode, setIsEmailSignupMode] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [successData, setSuccessData] = useState<{ email: string, name: string, phone: string } | null>(null)

  // Controlled inputs
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [phone, setPhone] = useState('')
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/signup'
  const kakaoSignupMode = searchParams.get('provider') === 'kakao' && searchParams.get('signup') === '1'
  const callbackPath = new URLSearchParams({
    next,
    provider: 'kakao',
    signup: '1',
  }).toString()

  const [kakaoEmail, setKakaoEmail] = useState('')
  const [kakaoUserId, setKakaoUserId] = useState('')
  const [kakaoName, setKakaoName] = useState('')
  const [kakaoPhone, setKakaoPhone] = useState('')

  useEffect(() => {
    if (!kakaoSignupMode) {
      return
    }

    const loadKakaoProfile = async () => {
      setIsKakaoProfileLoading(true)
      try {
        const supabase = createClient()
        const [{ data: userData, error: userError }, { data: sessionData }] = await Promise.all([
          supabase.auth.getUser(),
          supabase.auth.getSession(),
        ])

        if (userError || !userData.user) {
          console.error('Failed to get kakao user:', userError)
          return
        }

        const user = userData.user
        const metadata = getFirstObject(user.user_metadata) || {}
        const appMetadata = getFirstObject(user.app_metadata) || {}
        const identities = user.identities || []
        const kakaoIdentity = identities.find(
          (identity: { provider?: string }) => identity.provider === 'kakao'
        ) as ({ id?: string, identity_id?: string, identity_data?: unknown } | undefined)
        const identityData = getFirstObject(kakaoIdentity?.identity_data) || {}
        const kakaoAccount = getFirstObject(identityData.kakao_account, metadata.kakao_account) || {}
        const kakaoProfile = getFirstObject(kakaoAccount.profile) || {}

        const providerToken = sessionData.session?.provider_token || ''
        let kakaoApiPayload: JsonObject | null = null
        if (providerToken) {
          try {
            const response = await fetch('https://kapi.kakao.com/v2/user/me', {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${providerToken}`,
              },
              cache: 'no-store',
            })

            if (response.ok) {
              const payload = await response.json()
              if (isJsonObject(payload)) {
                kakaoApiPayload = payload
              }
            } else {
              console.warn('[Kakao Signup] Failed to fetch /v2/user/me:', response.status)
            }
          } catch (error) {
            console.warn('[Kakao Signup] Failed to fetch Kakao user info:', error)
          }
        }

        const apiKakaoAccount = getFirstObject(kakaoApiPayload?.kakao_account) || {}
        const apiKakaoProfile = getFirstObject(apiKakaoAccount.profile) || {}

        const resolvedEmail = getFirstText(
          user.email,
          metadata.email,
          identityData.email,
          kakaoAccount.email,
          apiKakaoAccount.email,
        )

        const resolvedProvider = getFirstText(
          appMetadata.provider,
          metadata.provider,
          'kakao',
        )

        const resolvedUserId = getFirstText(
          metadata.kakao_id,
          metadata.provider_id,
          metadata.sub,
          metadata.id,
          identityData.provider_id,
          identityData.sub,
          identityData.id,
          kakaoApiPayload?.id,
          kakaoApiPayload?.sub,
          kakaoIdentity?.identity_id,
          kakaoIdentity?.id,
          appMetadata.provider_id,
          appMetadata.provider_uid,
          appMetadata.sub,
        )

        const resolvedName = getFirstText(
          metadata.full_name,
          metadata.name,
          metadata.nickname,
          identityData.name,
          identityData.nickname,
          kakaoAccount.name,
          apiKakaoAccount.name,
          kakaoProfile.nickname,
          apiKakaoProfile.nickname,
        )

        const resolvedPhone = normalizeKakaoPhoneNumber(
          getFirstText(
            metadata.phone,
            metadata.phone_number,
            identityData.phone,
            identityData.phone_number,
            kakaoAccount.phone,
            kakaoAccount.phone_number,
            apiKakaoAccount.phone,
            apiKakaoAccount.phone_number,
          )
        )

        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('email, name, phone, kakao_email, kakao_id, provider')
          .eq('id', user.id)
          .maybeSingle()

        if (profileError) {
          console.warn('[Kakao Signup] Failed to read profiles row:', profileError.message)
        }

        const mergedEmail = getFirstText(profileData?.email, resolvedEmail)
        const mergedName = getFirstText(profileData?.name, resolvedName)
        const mergedPhone = getFirstText(profileData?.phone, resolvedPhone)
        const mergedKakaoEmail = getFirstText(profileData?.kakao_email, resolvedEmail)
        const mergedKakaoId = getFirstText(profileData?.kakao_id, resolvedUserId)
        const mergedProvider = getFirstText(profileData?.provider, resolvedProvider, 'kakao')

        let syncedProfile = profileData
        if (profileData) {
          const shouldSyncProfile = (
            profileData.email !== (mergedEmail || null)
            || profileData.name !== (mergedName || null)
            || profileData.phone !== (mergedPhone || null)
            || profileData.kakao_email !== (mergedKakaoEmail || null)
            || profileData.kakao_id !== (mergedKakaoId || null)
            || profileData.provider !== (mergedProvider || null)
          )

          if (shouldSyncProfile) {
            const { data: updatedProfile, error: updateError } = await supabase
              .from('profiles')
              .update({
                email: mergedEmail || null,
                name: mergedName || null,
                phone: mergedPhone || null,
                kakao_email: mergedKakaoEmail || null,
                kakao_id: mergedKakaoId || null,
                provider: mergedProvider || null,
              })
              .eq('id', user.id)
              .select('email, name, phone, kakao_email, kakao_id, provider')
              .single()

            if (updateError) {
              console.warn('[Kakao Signup] Failed to sync profiles row:', updateError.message)
            } else {
              syncedProfile = updatedProfile
            }
          }
        }

        const profileEmail = getFirstText(
          syncedProfile?.email,
          syncedProfile?.kakao_email,
          mergedEmail,
        )
        const profileName = getFirstText(syncedProfile?.name, mergedName)
        const profilePhone = getFirstText(syncedProfile?.phone, mergedPhone)
        const profileKakaoId = getFirstText(syncedProfile?.kakao_id, mergedKakaoId)

        setKakaoEmail(profileEmail)
        setKakaoUserId(profileKakaoId)
        setKakaoName(profileName)
        setKakaoPhone(profilePhone)

        if (process.env.NODE_ENV !== 'production') {
          console.groupCollapsed('[Kakao Signup Debug] resolved profile')
          console.log('resolved', {
            resolvedEmail,
            resolvedProvider,
            resolvedUserId,
            resolvedName,
            resolvedPhone,
            profileEmail,
            profileName,
            profilePhone,
            profileKakaoId,
            providerTokenAvailable: Boolean(providerToken),
          })
          console.log('profile_row', syncedProfile)
          console.log('user_metadata', metadata)
          console.log('app_metadata', appMetadata)
          console.log('identity_data', identityData)
          console.log('kakao_api_payload', kakaoApiPayload)
          console.groupEnd()
        }

        if (!resolvedPhone) {
          console.info(
            '[Kakao Signup] phone_number is empty. Kakao may not provide it when unavailable in the Kakao Account.'
          )
        }
      } finally {
        setIsKakaoProfileLoading(false)
      }
    }

    loadKakaoProfile()
  }, [kakaoSignupMode])

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

  async function handleKakaoSignup() {
    if (isLoading) return

    setIsLoading(true)
    const supabase = createClient()
    try {
      await supabase.auth.signOut({ scope: 'global' })
    } catch (error) {
      console.warn('Failed to clear prior session before Kakao signup:', error)
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?${callbackPath}`,
        queryParams: {
          prompt: 'select_account',
          scope: 'account_email,phone_number,name',
        },
      },
    })

    if (error) {
      setIsLoading(false)
      toast.error(error.message)
    }
  }

  async function handleKakaoProfileSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!kakaoName.trim()) {
      toast.error('카카오 이름 정보를 확인할 수 없습니다.')
      return
    }

    setIsLoading(true)
    const supabase = createClient()
    const { data: userData } = await supabase.auth.getUser()

    if (!userData.user) {
      setIsLoading(false)
      toast.error('로그인 세션을 찾을 수 없습니다.')
      return
    }

    const profileUpdate: {
      name: string | null
      provider: string
      signup_completed: boolean
      email?: string | null
      kakao_email?: string | null
      phone?: string | null
      kakao_id?: string | null
    } = {
      name: kakaoName.trim() || null,
      provider: 'kakao',
      signup_completed: true,
    }

    const sanitizedEmail = kakaoEmail.trim()
    const sanitizedPhone = kakaoPhone.trim()
    const sanitizedKakaoId = kakaoUserId.trim()

    if (sanitizedEmail) {
      profileUpdate.email = sanitizedEmail
      profileUpdate.kakao_email = sanitizedEmail
    }
    if (sanitizedPhone) {
      profileUpdate.phone = sanitizedPhone
    }
    if (sanitizedKakaoId) {
      profileUpdate.kakao_id = sanitizedKakaoId
    }

    const { data: updatedProfile, error } = await supabase
      .from('profiles')
      .update(profileUpdate)
      .eq('id', userData.user.id)
      .select('email, name, phone')
      .single()

    if (error) {
      setIsLoading(false)
      toast.error(`회원정보 저장 실패: ${error.message}`)
      return
    }

    const updatedEmail = getFirstText(updatedProfile?.email, sanitizedEmail)
    const updatedName = getFirstText(updatedProfile?.name, kakaoName.trim())
    const updatedPhone = getFirstText(updatedProfile?.phone, sanitizedPhone)

    setKakaoEmail(updatedEmail)
    setKakaoName(updatedName)
    setKakaoPhone(updatedPhone)
    setIsSuccess(true)
    setSuccessData({
      email: updatedEmail,
      name: updatedName,
      phone: updatedPhone
    })
    setIsKakaoSignupCompleted(true)
    setIsLoading(false)
    toast.success('카카오 간편가입이 완료되었습니다.')
  }


  if (isSuccess && successData) {
    const completedViaKakao = isKakaoSignupCompleted
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] py-12 px-4 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md shadow-2xl border-0 ring-1 ring-gray-200/50 bg-white/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-center text-green-600">
              {completedViaKakao ? '카카오 간편가입 완료' : '회원가입 완료'}
            </CardTitle>
            <CardDescription className="text-center">
              {completedViaKakao ? '카카오 간편가입이 완료되었습니다.' : '회원가입이 성공적으로 완료되었습니다.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg space-y-2 border border-gray-100">
              <div className="flex justify-between border-b border-gray-200 pb-2">
                <span className="text-gray-500">아이디(이메일)</span>
                <span className="font-medium">{successData.email}</span>
              </div>
              <div className="flex justify-between border-b border-gray-200 pb-2">
                <span className="text-gray-500">이름</span>
                <span className="font-medium">{successData.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">핸드폰</span>
                <span className="font-medium">{successData.phone}</span>
              </div>
            </div>
            {!completedViaKakao && (
              <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg space-y-2">
                <p className="text-sm font-semibold text-yellow-800 flex items-center gap-2">
                  <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
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
            )}
          </CardContent>
          <CardFooter>
            <Link href="/" className="w-full">
              <Button className="w-full h-11 text-md">메인 페이지로 이동하기</Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    )
  }

  if (kakaoSignupMode) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] py-12 px-4 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md shadow-2xl border-0 ring-1 ring-gray-200/50 bg-white/50 backdrop-blur-sm">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center tracking-tight">카카오 간편가입</CardTitle>
            <CardDescription className="text-center text-gray-500">
              카카오에서 전달받은 정보(이메일, 이름, 휴대폰 번호)를 확인합니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isKakaoProfileLoading ? (
              <div className="text-center py-8 text-sm text-gray-500">정보를 가져오는 중입니다...</div>
            ) : (
              <form onSubmit={handleKakaoProfileSubmit} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="kakaoEmail">카카오 이메일</Label>
                  <Input id="kakaoEmail" value={kakaoEmail} readOnly disabled className="h-10 bg-gray-100 text-gray-700" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="kakaoName">이름</Label>
                  <Input id="kakaoName" value={kakaoName} readOnly disabled className="h-10 bg-gray-100 text-gray-700" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="kakaoPhone">휴대폰 번호</Label>
                  <Input id="kakaoPhone" value={kakaoPhone} readOnly disabled className="h-10 bg-gray-100 text-gray-700" />
                  {!kakaoPhone && (
                    <p className="text-xs text-amber-600">
                      카카오 계정에 전화번호가 없거나 제공 불가 상태면 빈 값으로 전달될 수 있습니다.
                    </p>
                  )}
                </div>
                <Button className="w-full h-11 text-md font-medium" type="submit" disabled={isLoading}>
                  {isLoading ? '처리 중...' : '카카오 간편가입 완료'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!isEmailSignupMode) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] py-12 px-4 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md shadow-2xl border-0 ring-1 ring-gray-200/50 bg-white/50 backdrop-blur-sm">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center tracking-tight">회원가입</CardTitle>
            <CardDescription className="text-center text-gray-500">
              원하는 방법으로 회원가입을 진행해주세요
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="outline"
              type="button"
              onClick={handleKakaoSignup}
              disabled={isLoading}
              className="w-full bg-[#FEE500] text-[#191919] hover:bg-[#FEE500]/90 border-none h-11 shadow-sm font-medium"
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3C5.373 3 0 6.657 0 11.172c0 2.985 2.328 5.642 5.938 7.07l-1.38 5.105c-.13.48.465.84.866.566l6.06-4.14C11.83 19.83 12.165 19.84 12.5 19.84 19.127 19.84 24.5 16.184 24.5 11.67 24.5 7.156 19.127 3 12 3z"/>
              </svg>
              카카오 간편가입
            </Button>
            <Button
              type="button"
              onClick={() => setIsEmailSignupMode(true)}
              disabled={isLoading}
              className="w-full h-11 text-md font-medium"
            >
              일반가입
            </Button>
          </CardContent>
          <CardFooter className="flex justify-center pb-8">
            <div className="text-sm text-gray-500">
              이미 계정이 있으신가요? <Link href="/login" className="underline underline-offset-4 hover:text-primary font-medium ml-1">로그인</Link>
            </div>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md shadow-2xl border-0 ring-1 ring-gray-200/50 bg-white/50 backdrop-blur-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center tracking-tight">회원가입</CardTitle>
          <CardDescription className="text-center text-gray-500">
            서비스 이용을 위해 정보를 입력해주세요
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={handleSignup} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">이메일 (아이디) *</Label>
              <Input id="email" name="email" type="email" placeholder="name@example.com" required className="h-10" />
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
                className="h-10"
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
                className="h-10"
              />
              {confirmPassword.length > 0 && (
                <p className={`text-xs mt-1 ${password === confirmPassword ? 'text-green-600' : 'text-red-500'}`}>
                  {password === confirmPassword
                    ? '비밀번호가 일치합니다.'
                    : '비밀번호가 일치하지 않습니다.'}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="name">이름 *</Label>
              <Input id="name" name="name" placeholder="홍길동" required className="h-10" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">휴대폰 번호 *</Label>
              <Input
                id="phone"
                name="phone"
                placeholder="010-1234-5678"
                value={phone}
                onChange={handlePhoneChange}
                maxLength={13}
                required
                className="h-10"
              />
            </div>

            <Button className="w-full mt-6 h-11 text-md font-medium" type="submit" disabled={isLoading || (password !== confirmPassword)}>
              {isLoading ? '가입 처리 중...' : '가입하기'}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex justify-center pb-8">
          <div className="text-sm text-gray-500">
            이미 계정이 있으신가요? <Link href="/login" className="underline underline-offset-4 hover:text-primary font-medium ml-1">로그인</Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
