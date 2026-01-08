import { createClient } from '@/lib/supabase/server'
import AdminUploadClient from './admin-upload-client'

export default async function AdminUploadPage() {
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
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">문제 업로드</h1>
        <p className="text-gray-500 mt-1">커뮤니티에 공유할 문제를 직접 업로드합니다</p>
      </div>
      
      <AdminUploadClient 
        problemTypes={problemTypes || []} 
        gradeLevels={gradeLevels}
        difficulties={difficulties}
      />
    </div>
  )
}

