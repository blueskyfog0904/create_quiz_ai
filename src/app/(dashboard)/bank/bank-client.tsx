'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { QuestionList } from '@/components/features/bank/question-list'
import { Database } from '@/types/supabase'

type DBQuestion = Database['public']['Tables']['questions']['Row']
type ProblemType = {
  id: string
  type_name: string
}

interface BankClientProps {
  questions: DBQuestion[]
  problemTypes: ProblemType[]
  gradeLevels: string[]
  difficulties: string[]
}

export function BankClient({ questions, problemTypes, gradeLevels, difficulties }: BankClientProps) {
  const [selectedTypeId, setSelectedTypeId] = useState<string>('all')
  const [selectedGrade, setSelectedGrade] = useState<string>('all')
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('all')
  const [selectedSource, setSelectedSource] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'latest' | 'oldest'>('latest')

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

      return true
    })
    
    // Apply sorting
    result.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime()
      const dateB = new Date(b.created_at).getTime()
      return sortBy === 'latest' ? dateB - dateA : dateA - dateB
    })
    
    return result
  }, [questions, selectedTypeId, selectedGrade, selectedDifficulty, selectedSource, sortBy])

  const handleReset = () => {
    setSelectedTypeId('all')
    setSelectedGrade('all')
    setSelectedDifficulty('all')
    setSelectedSource('all')
    setSortBy('latest')
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">문제 은행</h1>
          <p className="text-gray-500">저장된 문제를 관리합니다.</p>
        </div>
        <Link href="/generate">
          <Button>+ 새 문제 생성</Button>
        </Link>
      </div>

      {/* Filter Section */}
      <div className="bg-white border rounded-lg p-6 mb-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">필터</h2>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          {/* Problem Type Filter */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              문제 유형
            </label>
            <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
              <SelectTrigger>
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
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              학년
            </label>
            <Select value={selectedGrade} onValueChange={setSelectedGrade}>
              <SelectTrigger>
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
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              난이도
            </label>
            <Select value={selectedDifficulty} onValueChange={setSelectedDifficulty}>
              <SelectTrigger>
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
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              출처
            </label>
            <Select value={selectedSource} onValueChange={setSelectedSource}>
              <SelectTrigger>
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem value="ai_generated">AI생성문제</SelectItem>
                <SelectItem value="from_community">문제은행</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sort Filter */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              정렬
            </label>
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as 'latest' | 'oldest')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest">최신순</SelectItem>
                <SelectItem value="oldest">오래된 순</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Reset Button */}
          <div className="flex items-end">
            <Button 
              variant="outline" 
              onClick={handleReset}
              className="w-full"
            >
              초기화
            </Button>
          </div>
        </div>

        {/* Results Count */}
        <div className="mt-4 text-sm text-gray-600">
          총 <span className="font-semibold text-primary">{filteredQuestions.length}</span>개의 문제
          {filteredQuestions.length !== questions.length && (
            <span className="text-gray-500"> (전체 {questions.length}개 중)</span>
          )}
        </div>
      </div>

      {/* Question List */}
      <QuestionList questions={filteredQuestions} />
    </div>
  )
}

