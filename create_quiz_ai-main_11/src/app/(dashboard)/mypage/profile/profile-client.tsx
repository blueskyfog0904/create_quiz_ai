'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Database } from '@/types/supabase'

type Profile = Database['public']['Tables']['profiles']['Row']

interface ProfileClientProps {
  profile: Profile | null
  email: string
}

export function ProfileClient({ profile, email }: ProfileClientProps) {
  const router = useRouter()
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Profile editing states
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [phone, setPhone] = useState(profile?.phone || '')
  const [role, setRole] = useState(profile?.role || '')
  const [organization, setOrganization] = useState(profile?.organization || '')
  const [isSavingProfile, setIsSavingProfile] = useState(false)

  useEffect(() => {
    if (profile) {
      setPhone(profile.phone || '')
      setRole(profile.role || '')
      setOrganization(profile.organization || '')
    }
  }, [profile])

  const getRoleLabel = (role: string | null | undefined) => {
    switch (role) {
      case 'teacher':
        return '교사'
      case 'academy_instructor':
        return '학원강사'
      default:
        return '미설정'
    }
  }

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

  const handleProfileSave = async () => {
    if (!profile) return

    setIsSavingProfile(true)
    const supabase = createClient()

    try {
      const updateData: {
        phone: string | null
        role: string | null
        organization: string | null
      } = {
        phone: phone?.trim() || null,
        role: role?.trim() || null,
        organization: organization?.trim() || null,
      }

      const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', profile.id)

      if (error) {
        throw error
      }

      toast.success('프로필 정보가 성공적으로 업데이트되었습니다.')
      setIsEditingProfile(false)
      router.refresh()
    } catch (error: any) {
      console.error('Profile update error:', error)
      toast.error(error.message || '프로필 업데이트에 실패했습니다.')
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleProfileCancel = () => {
    if (profile) {
      setPhone(profile.phone || '')
      setRole(profile.role || '')
      setOrganization(profile.organization || '')
    }
    setIsEditingProfile(false)
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (newPassword !== confirmPassword) {
      toast.error('새 비밀번호가 일치하지 않습니다.')
      return
    }

    if (newPassword.length < 6) {
      toast.error('비밀번호는 최소 6자 이상이어야 합니다.')
      return
    }

    setIsSubmitting(true)
    const supabase = createClient()

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (error) {
        throw error
      }

      toast.success('비밀번호가 성공적으로 변경되었습니다.')
      setIsChangingPassword(false)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error: any) {
      toast.error(error.message || '비밀번호 변경에 실패했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Profile Information */}
      <Card>
        <CardHeader>
          <CardTitle>내정보</CardTitle>
          <CardDescription>계정 기본 정보입니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-gray-500">이름</Label>
              <div className="p-3 bg-gray-50 rounded-lg border">
                <span className="font-medium">{profile?.name || '미설정'}</span>
                <span className="text-xs text-gray-400 ml-2">(변경 불가)</span>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label className="text-gray-500">이메일</Label>
              <div className="p-3 bg-gray-50 rounded-lg border">
                <span className="font-medium">{email}</span>
                <span className="text-xs text-gray-400 ml-2">(변경 불가)</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-gray-500">역할</Label>
              {isEditingProfile ? (
                <Select 
                  value={role?.trim() || undefined} 
                  onValueChange={(value) => setRole(value || '')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="역할을 선택해주세요" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="teacher">교사</SelectItem>
                    <SelectItem value="academy_instructor">학원강사</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="p-3 bg-gray-50 rounded-lg border">
                  <span className="font-medium">{getRoleLabel(profile?.role)}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-gray-500">소속</Label>
              {isEditingProfile ? (
                <Input
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="OOO 학교"
                />
              ) : (
                <div className="p-3 bg-gray-50 rounded-lg border">
                  <span className="font-medium">{profile?.organization || '미설정'}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-gray-500">휴대폰 번호</Label>
              {isEditingProfile ? (
                <Input
                  value={phone}
                  onChange={handlePhoneChange}
                  placeholder="010-1234-5678"
                  maxLength={13}
                />
              ) : (
                <div className="p-3 bg-gray-50 rounded-lg border">
                  <span className="font-medium">{profile?.phone || '미설정'}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-gray-500">가입일</Label>
              <div className="p-3 bg-gray-50 rounded-lg border">
                <span className="font-medium">
                  {profile?.created_at 
                    ? new Date(profile.created_at).toLocaleDateString('ko-KR')
                    : '알 수 없음'}
                </span>
              </div>
            </div>
          </div>
          
          {!isEditingProfile ? (
            <Button onClick={() => setIsEditingProfile(true)} className="mt-4">
              정보 수정하기
            </Button>
          ) : (
            <div className="flex gap-2 mt-4">
              <Button onClick={handleProfileSave} disabled={isSavingProfile}>
                {isSavingProfile ? '저장 중...' : '저장하기'}
              </Button>
              <Button variant="outline" onClick={handleProfileCancel} disabled={isSavingProfile}>
                취소
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Password Change */}
      <Card>
        <CardHeader>
          <CardTitle>비밀번호 변경</CardTitle>
          <CardDescription>계정 보안을 위해 주기적으로 비밀번호를 변경해주세요.</CardDescription>
        </CardHeader>
        <CardContent>
          {!isChangingPassword ? (
            <Button onClick={() => setIsChangingPassword(true)}>
              비밀번호 변경하기
            </Button>
          ) : (
            <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
              <div className="space-y-2">
                <Label htmlFor="newPassword">새 비밀번호</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="새 비밀번호 입력"
                  required
                  minLength={6}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">새 비밀번호 확인</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="새 비밀번호 확인"
                  required
                />
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-sm text-red-500">비밀번호가 일치하지 않습니다.</p>
                )}
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? '변경 중...' : '변경하기'}
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => {
                    setIsChangingPassword(false)
                    setNewPassword('')
                    setConfirmPassword('')
                  }}
                >
                  취소
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

