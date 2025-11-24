import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import CommunityBankClient from './community-bank-client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default async function CommunityBankPage() {
  const user = await requireAuth()
  const supabase = await createClient()
  
  // Check if user is admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  
  const isAdmin = profile?.is_admin || false
  
  // Fetch admin-uploaded questions
  const { data: questions } = await supabase
    .from('questions')
    .select('*, problem_types(type_name)')
    .eq('source', 'admin_uploaded')
    .order('created_at', { ascending: false })
  
  // Fetch problem types for filtering
  const { data: problemTypes } = await supabase
    .from('problem_types')
    .select('id, type_name')
    .eq('is_active', true)
    .order('type_name')
  
  // Get unique grade levels and difficulties
  const gradeLevels = Array.from(new Set(questions?.map(q => q.grade_level).filter(Boolean)))
  const difficulties = Array.from(new Set(questions?.map(q => q.difficulty).filter(Boolean)))
  
  return (
    <div className="container mx-auto py-8 px-4">
      <Link href="/bank">
        <Button variant="ghost" className="mb-4">← 문제 은행으로</Button>
      </Link>
      
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">커뮤니티 은행</h1>
        <p className="text-gray-500">관리자가 공유한 문제를 조회하고 저장할 수 있습니다.</p>
      </div>
      
      <CommunityBankClient 
        questions={questions || []} 
        problemTypes={problemTypes || []}
        gradeLevels={gradeLevels}
        difficulties={difficulties}
        isAdmin={isAdmin}
      />
    </div>
  )
}

