'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { QuestionActionBar, QuestionGrid, CreateExamDialog } from '@/components/features/bank/question-list'
import { RandomExamDialog } from '@/components/features/question-bank/random-exam-dialog'
import { Database } from '@/types/supabase'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

type DBQuestion = Database['public']['Tables']['questions']['Row'] & {
  problem_types?: { type_name: string } | null
}
type ProblemType = {
  id: string
  type_name: string
}

interface PurchasedClientProps {
  questions: DBQuestion[]
  problemTypes: ProblemType[]
  gradeLevels: string[]
  difficulties: string[]
  highlightedJobId?: string | null
  highlightedSavedCount?: number
  initialSelectedSource?: 'all' | 'ai_generated' | 'from_community'
  marketMenuSlug?: string | null
  marketMenuTitle?: string | null
  workspaceSubject: WorkspaceSubject
}

export function PurchasedClient({
  questions,
  problemTypes,
  gradeLevels,
  difficulties,
  highlightedJobId = null,
  highlightedSavedCount = 0,
  initialSelectedSource = 'all',
  marketMenuSlug = null,
  marketMenuTitle = null,
  workspaceSubject,
}: PurchasedClientProps) {
  const router = useRouter()
  // Filter state
  const [selectedTypeId, setSelectedTypeId] = useState<string>('all')
  const [selectedGrade, setSelectedGrade] = useState<string>('all')
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('all')
  const [selectedSource, setSelectedSource] = useState<string>(initialSelectedSource)
  const [selectedSourceType, setSelectedSourceType] = useState<string>('')
  const [selectedSource1, setSelectedSource1] = useState<string>('all')
  const [selectedSource2, setSelectedSource2] = useState<string>('all')
  const [selectedSource3, setSelectedSource3] = useState<string>('all')
  const [selectedSource4, setSelectedSource4] = useState<string>('all')
  const [selectedRating, setSelectedRating] = useState<string>('all')
  const [tagFilter, setTagFilter] = useState<string>('')
  const [sortBy, setSortBy] = useState<'latest' | 'oldest'>('latest')
  
  // Source Configs for source type filter (with full config details)
  interface SourceConfig {
    id: string
    type_name: string
    source_1_label?: string | null
    source_1_options?: string[] | null
    source_2_label?: string | null
    source_2_options?: string[] | null
    source_3_label?: string | null
    source_3_options?: string[] | null
    source_4_label?: string | null
    source_4_options?: string[] | null
  }
  const [sourceConfigs, setSourceConfigs] = useState<SourceConfig[]>([])
  
  // Fetch source configs
  useEffect(() => {
    const fetchSourceConfigs = async () => {
      try {
        const response = await fetch('/api/admin/source-configs')
        if (response.ok) {
          const data = await response.json()
          setSourceConfigs(data.configs || [])
        }
      } catch (error) {
        console.error('Failed to fetch source configs:', error)
      }
    }
    fetchSourceConfigs()
  }, [])

  // Get active source config based on selected source type
  const activeSourceConfig = useMemo(() => {
    return sourceConfigs.find(config => config.type_name === selectedSourceType)
  }, [sourceConfigs, selectedSourceType])
  
  // Selection & Zoom state (lifted from QuestionList)
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([])
  const [scale, setScale] = useState(100)
  const [isExamDialogOpen, setIsExamDialogOpen] = useState(false)
  const [isRandomExamDialogOpen, setIsRandomExamDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const subjectQuery = `?subject=${workspaceSubject}`

  // Collapsible filter state
  const [isFilterExpanded, setIsFilterExpanded] = useState(true)
  const filterRef = useRef<HTMLDivElement>(null)

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
    const result = questions.filter(question => {
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

      // Filter by source type (only for community questions)
      if (selectedSourceType && (!question.source_type || !question.source_type.includes(selectedSourceType))) {
        return false
      }

      // Filter by source 1-4 (partial match - e.g., "37" matches "(37번)")
      if (selectedSource1 !== 'all' && (!question.source_1 || !question.source_1.includes(selectedSource1))) {
        return false
      }
      if (selectedSource2 !== 'all' && (!question.source_2 || !question.source_2.includes(selectedSource2))) {
        return false
      }
      if (selectedSource3 !== 'all' && (!question.source_3 || !question.source_3.includes(selectedSource3))) {
        return false
      }
      if (selectedSource4 !== 'all' && (!question.source_4 || !question.source_4.includes(selectedSource4))) {
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
  }, [questions, selectedTypeId, selectedGrade, selectedDifficulty, selectedSource, selectedSourceType, selectedSource1, selectedSource2, selectedSource3, selectedSource4, selectedRating, tagFilter, sortBy])

  const handleReset = () => {
    setSelectedTypeId('all')
    setSelectedGrade('all')
    setSelectedDifficulty('all')
    setSelectedSource('all')
    setSelectedSourceType('')
    setSelectedSource1('all')
    setSelectedSource2('all')
    setSelectedSource3('all')
    setSelectedSource4('all')
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
          workspaceSubject,
        }),
      })

      if (!res.ok) {
        throw new Error('Failed to create exam paper')
      }

      const data = await res.json()
      toast.success('시험지가 생성되었습니다')
      router.push(`/library/exam-papers/${data.data.id}${subjectQuery}`)
      setSelectedQuestionIds([])
    } catch (error) {
        console.error(error)
        toast.error('시험지 생성에 실패했습니다')
        throw error
    }
  }

  const handleDeleteSelected = async () => {
    setIsDeleting(true)
    let successCount = 0
    let errorCount = 0

    for (const questionId of selectedQuestionIds) {
      try {
        const res = await fetch(`/api/questions/${questionId}${subjectQuery}`, {
          method: 'DELETE',
        })
        if (res.ok) {
          successCount++
        } else {
          errorCount++
        }
      } catch (error) {
        console.error(`Failed to delete question ${questionId}:`, error)
        errorCount++
      }
    }

    setIsDeleting(false)
    setIsDeleteDialogOpen(false)

    if (successCount > 0) {
      toast.success(`${successCount}개의 문제가 삭제되었습니다.`)
      setSelectedQuestionIds([])
      router.refresh()
    }
    if (errorCount > 0) {
      toast.error(`${errorCount}개의 문제 삭제에 실패했습니다.`)
    }
  }

  return (
    <div className="container mx-auto py-6 px-4">
      {highlightedJobId ? (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-semibold">이 생성 작업에서 저장한 문제 {highlightedSavedCount}개를 표시 중입니다.</p>
            <p className="mt-1 text-emerald-700">현재 생성 작업에서 저장된 결과만 우선 보여주고 있습니다.</p>
          </div>
          <Button variant="outline" onClick={() => router.push(`/library/purchased${subjectQuery}`)}>
            전체 보기
          </Button>
        </div>
      ) : null}

      {marketMenuSlug ? (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-800 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-semibold">{marketMenuTitle ?? marketMenuSlug} 문제마켓 메뉴 화면입니다.</p>
            <p className="mt-1 text-sky-700">현재 문제마켓 기준으로 이동했으며, 기본 탭은 문제마켓으로 맞춰졌습니다.</p>
          </div>
          <Button variant="outline" onClick={() => router.push(`/library/purchased${subjectQuery}`)}>
            영어문제 관리 전체 보기
          </Button>
        </div>
      ) : null}

      {/* Sticky Header Container */}
      <div className="sticky top-16 z-40 bg-white -mx-4 px-4 pt-4 pb-2 shadow-sm border-b mb-6 transition-all">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-6">
            <div>
              <h1 className="text-2xl font-bold mb-1">영어문제 관리</h1>
              <p className="text-sm text-gray-500">저장된 문제를 관리하고 문제지를 만들 수 있습니다.</p>
            </div>
            {/* Source Type Toggle Buttons */}
            <div className="flex items-center bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setSelectedSource('all')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                  selectedSource === 'all'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                전체보기
              </button>
              <button
                onClick={() => setSelectedSource('ai_generated')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                  selectedSource === 'ai_generated'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                AI생성문제
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setIsRandomExamDialogOpen(true)}>
              랜덤 문제지 생성
            </Button>
            <Link href={`/generate${subjectQuery}`}>
              <Button size="sm">+ 새 문제 생성</Button>
            </Link>
          </div>
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
              <div className="grid gap-3 items-end grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {/* Problem Type Filter */}
                <div className="min-w-0">
                  <label className="text-[11px] font-medium text-gray-600 mb-1 block">문제 유형</label>
                  <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
                    <SelectTrigger className="h-8 text-xs w-full min-w-0">
                      <SelectValue placeholder="전체" className="truncate" />
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
                <div className="min-w-0">
                  <label className="text-[11px] font-medium text-gray-600 mb-1 block">학년</label>
                  <Select value={selectedGrade} onValueChange={setSelectedGrade}>
                    <SelectTrigger className="h-8 text-xs w-full min-w-0">
                      <SelectValue placeholder="전체" className="truncate" />
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
                <div className="min-w-0">
                  <label className="text-[11px] font-medium text-gray-600 mb-1 block">난이도</label>
                  <Select value={selectedDifficulty} onValueChange={setSelectedDifficulty}>
                    <SelectTrigger className="h-8 text-xs w-full min-w-0">
                      <SelectValue placeholder="전체" className="truncate" />
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

                {/* Rating Filter */}
                <div className="min-w-0">
                  <label className="text-[11px] font-medium text-gray-600 mb-1 block">별점</label>
                  <Select value={selectedRating} onValueChange={setSelectedRating}>
                    <SelectTrigger className="h-8 text-xs w-full min-w-0">
                      <SelectValue placeholder="전체" className="truncate" />
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
                <div className="min-w-0">
                  <label className="text-[11px] font-medium text-gray-600 mb-1 block">정렬</label>
                  <Select value={sortBy} onValueChange={(value) => setSortBy(value as 'latest' | 'oldest')}>
                    <SelectTrigger className="h-8 text-xs w-full min-w-0">
                      <SelectValue className="truncate" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="latest">최신순</SelectItem>
                      <SelectItem value="oldest">오래된 순</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Tag Filter */}
                <div className="min-w-0">
                  <label className="text-[11px] font-medium text-gray-600 mb-1 block">태그 검색</label>
                  <Input 
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value)}
                    placeholder="태그1 태그2..."
                    className="h-8 text-xs w-full min-w-0"
                  />
                </div>

                {/* Source Filters Group - Only visible when not filtering by AI generated */}
                {selectedSource !== 'ai_generated' && (
                  <div className="min-w-0 lg:col-span-4 xl:col-span-6 2xl:col-span-6 flex flex-wrap items-end gap-2 p-2 bg-indigo-50/80 rounded-lg border border-indigo-100">
                    {/* Source Type Filter */}
                    <div className="min-w-0 flex-1">
                      <label className="text-[11px] font-medium text-indigo-900 mb-1 block">출처 종류</label>
                      {sourceConfigs.length > 0 ? (
                        <Select 
                          value={selectedSourceType || 'all'} 
                          onValueChange={(value) => {
                            setSelectedSourceType(value === 'all' ? '' : value)
                            setSelectedSource1('all')
                            setSelectedSource2('all')
                            setSelectedSource3('all')
                            setSelectedSource4('all')
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs w-full min-w-0 bg-white border-indigo-200">
                            <SelectValue placeholder="전체" className="truncate" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">전체</SelectItem>
                            {sourceConfigs.map((config) => (
                              <SelectItem key={config.id} value={config.type_name}>
                                {config.type_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          placeholder="예: 모의고사"
                          value={selectedSourceType}
                          onChange={(e) => setSelectedSourceType(e.target.value)}
                          className="h-8 text-xs w-full min-w-0 bg-white border-indigo-200"
                        />
                      )}
                    </div>
                    
                    {/* Source 1 Filter */}
                    {activeSourceConfig?.source_1_label && (
                      <div className="min-w-0 flex-1">
                        <label className="text-[11px] font-medium text-indigo-900 mb-1 block">
                          {activeSourceConfig.source_1_label}
                        </label>
                        {activeSourceConfig.source_1_options && activeSourceConfig.source_1_options.length > 0 ? (
                          <Select value={selectedSource1} onValueChange={setSelectedSource1}>
                            <SelectTrigger className="h-8 text-xs w-full min-w-0 bg-white border-indigo-200">
                              <SelectValue placeholder="전체" className="truncate" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">전체</SelectItem>
                              {activeSourceConfig.source_1_options.map((option, idx) => (
                                <SelectItem key={idx} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            placeholder="직접 입력"
                            value={selectedSource1 === 'all' ? '' : selectedSource1}
                            onChange={(e) => setSelectedSource1(e.target.value || 'all')}
                            className="h-8 text-xs w-full min-w-0 bg-white border-indigo-200"
                          />
                        )}
                      </div>
                    )}

                    {/* Source 2 Filter */}
                    {activeSourceConfig?.source_2_label && (
                      <div className="min-w-0 flex-1">
                        <label className="text-[11px] font-medium text-indigo-900 mb-1 block">
                          {activeSourceConfig.source_2_label}
                        </label>
                        {activeSourceConfig.source_2_options && activeSourceConfig.source_2_options.length > 0 ? (
                          <Select value={selectedSource2} onValueChange={setSelectedSource2}>
                            <SelectTrigger className="h-8 text-xs w-full min-w-0 bg-white border-indigo-200">
                              <SelectValue placeholder="전체" className="truncate" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">전체</SelectItem>
                              {activeSourceConfig.source_2_options.map((option, idx) => (
                                <SelectItem key={idx} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            placeholder="직접 입력"
                            value={selectedSource2 === 'all' ? '' : selectedSource2}
                            onChange={(e) => setSelectedSource2(e.target.value || 'all')}
                            className="h-8 text-xs w-full min-w-0 bg-white border-indigo-200"
                          />
                        )}
                      </div>
                    )}

                    {/* Source 3 Filter */}
                    {activeSourceConfig?.source_3_label && (
                      <div className="min-w-0 flex-1">
                        <label className="text-[11px] font-medium text-indigo-900 mb-1 block">
                          {activeSourceConfig.source_3_label}
                        </label>
                        {activeSourceConfig.source_3_options && activeSourceConfig.source_3_options.length > 0 ? (
                          <Select value={selectedSource3} onValueChange={setSelectedSource3}>
                            <SelectTrigger className="h-8 text-xs w-full min-w-0 bg-white border-indigo-200">
                              <SelectValue placeholder="전체" className="truncate" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">전체</SelectItem>
                              {activeSourceConfig.source_3_options.map((option, idx) => (
                                <SelectItem key={idx} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            placeholder="직접 입력"
                            value={selectedSource3 === 'all' ? '' : selectedSource3}
                            onChange={(e) => setSelectedSource3(e.target.value || 'all')}
                            className="h-8 text-xs w-full min-w-0 bg-white border-indigo-200"
                          />
                        )}
                      </div>
                    )}

                    {/* Source 4 Filter */}
                    {activeSourceConfig?.source_4_label && (
                      <div className="min-w-0 flex-1">
                        <label className="text-[11px] font-medium text-indigo-900 mb-1 block">
                          {activeSourceConfig.source_4_label}
                        </label>
                        {activeSourceConfig.source_4_options && activeSourceConfig.source_4_options.length > 0 ? (
                          <Select value={selectedSource4} onValueChange={setSelectedSource4}>
                            <SelectTrigger className="h-8 text-xs w-full min-w-0 bg-white border-indigo-200">
                              <SelectValue placeholder="전체" className="truncate" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">전체</SelectItem>
                              {activeSourceConfig.source_4_options.map((option, idx) => (
                                <SelectItem key={idx} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            placeholder="직접 입력"
                            value={selectedSource4 === 'all' ? '' : selectedSource4}
                            onChange={(e) => setSelectedSource4(e.target.value || 'all')}
                            className="h-8 text-xs w-full min-w-0 bg-white border-indigo-200"
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Reset Button */}
                <Button 
                  onClick={handleReset}
                  size="sm"
                  className="h-8 text-xs px-4 lg:col-span-4 xl:col-span-6"
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
                onDeleteSelected={() => setIsDeleteDialogOpen(true)}
            />
         </div>
      </div>

      {/* Question Grid */}
      <QuestionGrid
        questions={filteredQuestions}
        selectedQuestionIds={selectedQuestionIds}
        onSelectQuestion={handleSelectQuestion}
        scale={scale}
        workspaceSubject={workspaceSubject}
      />

      {/* Create Exam Dialog */}
      <CreateExamDialog
        open={isExamDialogOpen}
        onOpenChange={setIsExamDialogOpen}
        selectedCount={selectedQuestionIds.length}
        onConfirm={handleCreateExamPaper}
      />

      {/* Random Exam Dialog */}
      <RandomExamDialog
        open={isRandomExamDialogOpen}
        onOpenChange={setIsRandomExamDialogOpen}
        problemTypes={problemTypes}
        workspaceSubject={workspaceSubject}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>문제 삭제</DialogTitle>
            <DialogDescription>
              선택한 {selectedQuestionIds.length}개의 문제를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="justify-center gap-2">
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)} disabled={isDeleting}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleDeleteSelected} disabled={isDeleting}>
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isDeleting ? '삭제 중...' : '삭제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
