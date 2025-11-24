import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import AdminUploadClient from './admin-upload-client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default async function AdminUploadPage() {
  await requireAdmin()
  const supabase = await createClient()
  
  // Fetch all active problem types
  const { data: problemTypes } = await supabase
    .from('problem_types')
    .select('*')
    .eq('is_active', true)
    .order('type_name')
  
  // Define grade levels and difficulties
  const gradeLevels = ['중1', '중2', '중3', '고1', '고2', '고3']
  const difficulties = ['하', '중', '상']
  
  return (
    <div className="container mx-auto py-8 px-4">
      <Link href="/bank">
        <Button variant="ghost" className="mb-4">← 문제 은행으로</Button>
      </Link>
      
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">관리자 문제 업로드</h1>
        <p className="text-gray-500">커뮤니티에 공유할 문제를 직접 업로드합니다.</p>
      </div>
      
      <AdminUploadClient 
        problemTypes={problemTypes || []} 
        gradeLevels={gradeLevels}
        difficulties={difficulties}
      />
    </div>
  )
}

