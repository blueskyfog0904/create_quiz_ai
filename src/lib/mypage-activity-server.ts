import type { createClient } from '@/lib/supabase/server'

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>

export interface MypageActivityStats {
  totalQuestions: number
  monthlyQuestions: number
  aiGeneratedQuestions: number
  purchasedQuestions: number
  totalExamPapers: number
  monthlyExamPapers: number
}

export interface MypageRecentQuestion {
  id: string
  question_text: string
  source: string | null
  created_at: string
}

export interface MypageRecentExamPaper {
  id: string
  paper_title: string
  created_at: string
}

function getStartOfCurrentMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
}

export async function getMypageActivityStats(
  supabase: ServerSupabaseClient,
  userId: string
): Promise<MypageActivityStats> {
  const startOfMonth = getStartOfCurrentMonth()

  const countQuestions = () =>
    supabase.from('questions').select('*', { count: 'exact', head: true }).eq('user_id', userId)
  const countExamPapers = () =>
    supabase.from('exam_papers').select('*', { count: 'exact', head: true }).eq('user_id', userId)

  const [
    { count: totalQuestions },
    { count: monthlyQuestions },
    { count: aiGeneratedQuestions },
    { count: purchasedQuestions },
    { count: totalExamPapers },
    { count: monthlyExamPapers },
  ] = await Promise.all([
    countQuestions(),
    countQuestions().gte('created_at', startOfMonth),
    countQuestions().eq('source', 'ai_generated'),
    countQuestions().eq('source', 'from_community'),
    countExamPapers(),
    countExamPapers().gte('created_at', startOfMonth),
  ])

  return {
    totalQuestions: totalQuestions ?? 0,
    monthlyQuestions: monthlyQuestions ?? 0,
    aiGeneratedQuestions: aiGeneratedQuestions ?? 0,
    purchasedQuestions: purchasedQuestions ?? 0,
    totalExamPapers: totalExamPapers ?? 0,
    monthlyExamPapers: monthlyExamPapers ?? 0,
  }
}

export async function getMypageRecentActivity(
  supabase: ServerSupabaseClient,
  userId: string
): Promise<{ recentQuestions: MypageRecentQuestion[]; recentExamPapers: MypageRecentExamPaper[] }> {
  const [{ data: recentQuestions }, { data: recentExamPapers }] = await Promise.all([
    supabase
      .from('questions')
      .select('id, question_text, source, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('exam_papers')
      .select('id, paper_title, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  return {
    recentQuestions: recentQuestions ?? [],
    recentExamPapers: recentExamPapers ?? [],
  }
}
