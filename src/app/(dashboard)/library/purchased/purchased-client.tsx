'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { QuestionActionBar, QuestionGrid, CreateExamDialog } from '@/components/features/bank/question-list'
import { Database } from '@/types/supabase'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

type DBQuestion = Database['public']['Tables']['questions']['Row']
type ProblemType = {
  id: string
  type_name: string
}

interface PurchasedClientProps {
  questions: DBQuestion[]
  problemTypes: ProblemType[]
  gradeLevels: string[]
  difficulties: string[]
}

export function PurchasedClient({ questions, problemTypes, gradeLevels, difficulties }: PurchasedClientProps) {
  const router = useRouter()
  // Filter state
  const [selectedTypeId, setSelectedTypeId] = useState<string>('all')
  const [selectedGrade, setSelectedGrade] = useState<string>('all')
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('all')
  const [selectedSource, setSelectedSource] = useState<string>('all')
  const [selectedRating, setSelectedRating] = useState<string>('all')
  const [tagFilter, setTagFilter] = useState<string>('')
  const [sortBy, setSortBy] = useState<'latest' | 'oldest'>('latest')
  
  // Selection & Zoom state (lifted from QuestionList)
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([])
  const [scale, setScale] = useState(100)
  const [isExamDialogOpen, setIsExamDialogOpen] = useState(false)

  // Collapsible filter state
  const [isFilterExpanded, setIsFilterExpanded] = useState(true)
  const filterRef = useRef<HTMLDivElement>(null)
  const lastScrollY = useRef(0)

  // Auto-collapse filter on scroll down
  // Auto-collapse filter on scroll down logic removed to prevent conflict with sticky header
  // User can manually toggle the filter if they want to close it.
  /*
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY
      // Add a threshold of 10px to prevent minor jitters or layout shift scrolls from triggering collapse
      if (currentScrollY > lastScrollY.current + 10 && currentScrollY > 200) {
        // Scrolling down and past threshold
        setIsFilterExpanded(false)
      }
      lastScrollY.current = currentScrollY
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])
  */

  // Filter questions based on selected criteria
  const filteredQuestions = useMemo(() => {
    let result = questions.filter(question => {
      // Filter by problem type
      if (selectedTypeId !== 'all' && question.problem_type_id !== selectedTypeId) {
        return false
      }

      // Filter by grade level
      if (selectedGrade !== 'all' && question.grade_level !== selectedGrade) {
        return false
      }

      // Filter by difficulty
      if (selectedDifficulty !== 'all' && question.difficulty !== selectedDifficulty) {
        return false
      }

      // Filter by source
      if (selectedSource !== 'all' && question.source !== selectedSource) {
        return false
      }

      // Filter by rating
      if (selectedRating !== 'all') {
        const ratingValue = parseInt(selectedRating)
        if ((question.rating || 0) !== ratingValue) {
          return false
        }
      }

      // Filter by tags (AND condition - all tags must be present)
      if (tagFilter.trim()) {
        const questionTags = (question.tags || []).map(t => t.toLowerCase())
        const searchTags = tagFilter.split(/\s+/).map(t => t.trim().toLowerCase()).filter(t => t)
        // All search tags must be found in question tags
        const allTagsMatch = searchTags.every(searchTag => 
          questionTags.some(qTag => qTag.includes(searchTag))
        )
        if (!allTagsMatch) {
          return false
        }
      }

      return true
    })
    
    // Apply sorting
    result.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime()
      const dateB = new Date(b.created_at).getTime()
      return sortBy === 'latest' ? dateB - dateA : dateA - dateB
    })
    
    return result
  }, [questions, selectedTypeId, selectedGrade, selectedDifficulty, selectedSource, selectedRating, tagFilter, sortBy])

  const handleReset = () => {
    setSelectedTypeId('all')
    setSelectedGrade('all')
    setSelectedDifficulty('all')
    setSelectedSource('all')
    setSelectedRating('all')
    setTagFilter('')
    setSortBy('latest')
  }

  // Handlers for Question List (lifted logic)
  const handleSelectQuestion = (questionId: string, checked: boolean) => {
    if (checked) {
      setSelectedQuestionIds(prev => [...prev, questionId])
    } else {
      setSelectedQuestionIds(prev => prev.filter(id => id !== questionId))
    }
  }

  const handleSelectAll = () => {
    if (selectedQuestionIds.length === filteredQuestions.length) {
      setSelectedQuestionIds([])
    } else {
      setSelectedQuestionIds(filteredQuestions.map(q => q.id))
    }
  }

  const handleCreateExamPaper = async (title: string, description: string) => {
    try {
      const res = await fetch('/api/exam-papers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          description,
          questionIds: selectedQuestionIds,
        }),
      })

      if (!res.ok) {
        throw new Error('Failed to create exam paper')
      }

      const data = await res.json()
      toast.success('시험지가 생성되었습니다')
      router.push(`/library/exam-papers/${data.data.id}`)
      setSelectedQuestionIds([])
    } catch (error) {
        console.error(error)
        toast.error('시험지 생성에 실패했습니다')
        throw error
    }
  }

  return (
    <div className="container mx-auto py-6 px-4">
      {/* Sticky Header Container */}
      <div className="sticky top-16 z-40 bg-white -mx-4 px-4 pt-4 pb-2 shadow-sm border-b mb-6 transition-all">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold mb-1">내가 구매한 문제</h1>
            <p className="text-sm text-gray-500">저장된 문제를 관리하고 문제지를 만들 수 있습니다.</p>
          </div>
          <Link href="/generate">
            <Button size="sm">+ 새 문제 생성</Button>
          </Link>
        </div>

        {/* Collapsible Filter Section */}
        <div ref={filterRef} className="bg-white border rounded-lg shadow-sm mb-4 overflow-hidden transition-all duration-300">
          {/* Filter Header - Always visible */}
          <button 
            onClick={() => setIsFilterExpanded(!isFilterExpanded)}
            className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold">검색 필터</h2>
              <span className="text-xs text-gray-500">
                총 <span className="font-semibold text-primary">{filteredQuestions.length}</span>개의 문제
                {filteredQuestions.length !== questions.length && (
                  <span className="text-gray-400"> (전체 {questions.length}개 중)</span>
                )}
              </span>
            </div>
            {isFilterExpanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
          </button>

          {/* Filter Content - Collapsible */}
          <div className={`transition-all duration-300 ease-in-out ${isFilterExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'}`}>
            <div className="px-3 pb-3 pt-1">
              <div className="flex flex-wrap items-end gap-2">
                {/* Problem Type Filter */}
                <div className="w-[110px]">
                  <label className="text-[11px] font-medium text-gray-600 mb-1 block">문제 유형</label>
                  <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="전체" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체</SelectItem>
                      {problemTypes.map(type => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.type_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Grade Level Filter */}
                <div className="w-[110px]">
                  <label className="text-[11px] font-medium text-gray-600 mb-1 block">학년</label>
                  <Select value={selectedGrade} onValueChange={setSelectedGrade}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="전체" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체</SelectItem>
                      {gradeLevels.map(grade => (
                        <SelectItem key={grade} value={grade}>
                          {grade}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Difficulty Filter */}
                <div className="w-[110px]">
                  <label className="text-[11px] font-medium text-gray-600 mb-1 block">난이도</label>
                  <Select value={selectedDifficulty} onValueChange={setSelectedDifficulty}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="전체" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체</SelectItem>
                      {difficulties.map(difficulty => (
                        <SelectItem key={difficulty} value={difficulty}>
                          {difficulty}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Source Filter */}
                <div className="w-[110px]">
                  <label className="text-[11px] font-medium text-gray-600 mb-1 block">출처</label>
                  <Select value={selectedSource} onValueChange={setSelectedSource}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="전체" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체</SelectItem>
                      <SelectItem value="ai_generated">AI생성</SelectItem>
                      <SelectItem value="from_community">문제은행</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Rating Filter */}
                <div className="w-[110px]">
                  <label className="text-[11px] font-medium text-gray-600 mb-1 block">별점</label>
                  <Select value={selectedRating} onValueChange={setSelectedRating}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="전체" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체</SelectItem>
                      <SelectItem value="3">⭐⭐⭐</SelectItem>
                      <SelectItem value="2">⭐⭐</SelectItem>
                      <SelectItem value="1">⭐</SelectItem>
                      <SelectItem value="0">없음</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Sort Filter */}
                <div className="w-[110px]">
                  <label className="text-[11px] font-medium text-gray-600 mb-1 block">정렬</label>
                  <Select value={sortBy} onValueChange={(value) => setSortBy(value as 'latest' | 'oldest')}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="latest">최신순</SelectItem>
                      <SelectItem value="oldest">오래된 순</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Tag Filter */}
                <div className="w-[130px]">
                  <label className="text-[11px] font-medium text-gray-600 mb-1 block">태그 검색</label>
                  <Input 
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value)}
                    placeholder="태그1 태그2..."
                    className="h-8 text-xs"
                  />
                </div>

                {/* Reset Button */}
                <Button 
                  onClick={handleReset}
                  size="sm"
                  className="h-8 text-xs px-4"
                >
                  초기화
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Action Bar (Re-using QuestionActionBar but removing its sticky class logic by overriding class if possible, or we accept double sticky? No, we should prefer single sticky container. 
            However, QuestionActionBar has 'sticky' in its definition. We should update QuestionActionBar definition to accept className or remove sticky from it.
            Check QuestionActionBar implementation: It has hardcoded 'sticky top-16'. 
            This will cause double sticky behavior or it might stack. 
            Ideally, we remove 'sticky' from QuestionActionBar.
            Let's proceed for now, and I will strictly remove 'sticky' from QuestionList.tsx in the NEXT step which is cleaner.
         */}
         <div className="-mx-4 px-4">
            <QuestionActionBar
                selectedCount={selectedQuestionIds.length}
                totalCount={filteredQuestions.length}
                scale={scale}
                onScaleChange={setScale}
                onSelectAll={handleSelectAll}
                onCreateExamPaper={() => setIsExamDialogOpen(true)}
            />
         </div>
      </div>

      {/* Question Grid */}
      <QuestionGrid
        questions={filteredQuestions}
        selectedQuestionIds={selectedQuestionIds}
        onSelectQuestion={handleSelectQuestion}
        scale={scale}
      />

      {/* Create Exam Dialog */}
      <CreateExamDialog
        open={isExamDialogOpen}
        onOpenChange={setIsExamDialogOpen}
        selectedCount={selectedQuestionIds.length}
        onConfirm={handleCreateExamPaper}
      />
    </div>
  )
}
