import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FileText, Sparkles, Calendar, TrendingUp } from 'lucide-react'

export default async function HistoryPage() {
  const user = await requireAuth()
  const supabase = await createClient()
  
  // Get current date info
  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()
  const startOfMonth = new Date(currentYear, currentMonth, 1).toISOString()
  
  // Fetch total questions count
  const { count: totalQuestions } = await supabase
    .from('questions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
  
  // Fetch monthly questions count
  const { count: monthlyQuestions } = await supabase
    .from('questions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', startOfMonth)
  
  // Fetch AI generated questions count
  const { count: aiGeneratedQuestions } = await supabase
    .from('questions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('source', 'ai_generated')
  
  // Fetch questions from community (purchased)
  const { count: purchasedQuestions } = await supabase
    .from('questions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('source', 'from_community')
  
  // Fetch total exam papers count
  const { count: totalExamPapers } = await supabase
    .from('exam_papers')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
  
  // Fetch monthly exam papers count
  const { count: monthlyExamPapers } = await supabase
    .from('exam_papers')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', startOfMonth)
  
  // Get recent activity (last 10 items)
  const { data: recentQuestions } = await supabase
    .from('questions')
    .select('id, question_text, source, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(5)
  
  const { data: recentExamPapers } = await supabase
    .from('exam_papers')
    .select('id, paper_title, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(5)

  const monthName = now.toLocaleDateString('ko-KR', { month: 'long' })

  return (
    <div className="space-y-6">
      {/* Statistics Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">총 문제 수</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalQuestions || 0}</div>
            <p className="text-xs text-muted-foreground">
              이번 달 +{monthlyQuestions || 0}개
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">AI 생성 문제</CardTitle>
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{aiGeneratedQuestions || 0}</div>
            <p className="text-xs text-muted-foreground">
              AI로 직접 생성한 문제
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">구매한 문제</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{purchasedQuestions || 0}</div>
            <p className="text-xs text-muted-foreground">
              문제은행에서 가져온 문제
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">생성한 문제지</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalExamPapers || 0}</div>
            <p className="text-xs text-muted-foreground">
              이번 달 +{monthlyExamPapers || 0}개
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Summary */}
      <Card>
        <CardHeader>
          <CardTitle>{monthName} 활동 요약</CardTitle>
          <CardDescription>{currentYear}년 {monthName}의 활동 내역입니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-full">
                  <Sparkles className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="font-medium">이번 달 생성한 문제</p>
                  <p className="text-sm text-gray-500">AI 문제 생성 + 문제은행 가져오기</p>
                </div>
              </div>
              <span className="text-2xl font-bold text-blue-600">{monthlyQuestions || 0}개</span>
            </div>
            
            <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-full">
                  <FileText className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="font-medium">이번 달 생성한 문제지</p>
                  <p className="text-sm text-gray-500">시험지 및 자료 생성</p>
                </div>
              </div>
              <span className="text-2xl font-bold text-green-600">{monthlyExamPapers || 0}개</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent Questions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">최근 생성/저장한 문제</CardTitle>
          </CardHeader>
          <CardContent>
            {recentQuestions && recentQuestions.length > 0 ? (
              <div className="space-y-3">
                {recentQuestions.map((q) => (
                  <div key={q.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{q.question_text}</p>
                      <p className="text-xs text-gray-500">
                        {q.source === 'ai_generated' ? 'AI 생성' : '문제은행'} • 
                        {new Date(q.created_at).toLocaleDateString('ko-KR')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">
                아직 생성한 문제가 없습니다.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Recent Exam Papers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">최근 생성한 문제지</CardTitle>
          </CardHeader>
          <CardContent>
            {recentExamPapers && recentExamPapers.length > 0 ? (
              <div className="space-y-3">
                {recentExamPapers.map((ep) => (
                  <div key={ep.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{ep.paper_title}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(ep.created_at).toLocaleDateString('ko-KR')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">
                아직 생성한 문제지가 없습니다.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}


