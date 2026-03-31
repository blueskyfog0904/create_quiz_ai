'use client'

import { useState } from 'react'
import { Database } from '@/types/supabase'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Star, Plus, X, Calendar, Minus, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { getDifficultyLabel } from '@/lib/display-labels'
import { QuestionPreview } from '@/components/features/quiz/question-preview'
import { DEFAULT_WORKSPACE_SUBJECT, type WorkspaceSubject } from '@/lib/workspace-subject'

type DBQuestion = Database['public']['Tables']['questions']['Row'] & {
  problem_types?: { type_name: string } | null
  source_type?: string | null
  source_1?: string | null
  source_2?: string | null
  source_3?: string | null
  source_4?: string | null
}

// --- Question Item Component ---
function QuestionItem({ 
  question: initialQuestion, 
  isSelected, 
  onSelect,
  workspaceSubject
}: { 
  question: DBQuestion, 
  isSelected: boolean, 
  onSelect: (checked: boolean) => void,
  workspaceSubject: WorkspaceSubject
}) {
  const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback

  const router = useRouter()
  const [question, setQuestion] = useState(initialQuestion)
  const [isUpdating, setIsUpdating] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [isTagPopoverOpen, setIsTagPopoverOpen] = useState(false)
  const handleUpdate = async (updates: Partial<DBQuestion>) => {
    setIsUpdating(true)
    try {
      const res = await fetch(`/api/questions/${question.id}?subject=${workspaceSubject}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })

      const result = await res.json()
      if (!res.ok || !result.success) {
        throw new Error(result.error?.message || '업데이트 실패')
      }

      setQuestion({ ...question, ...updates })
      toast.success('저장되었습니다')
      router.refresh()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, '업데이트 실패'))
    } finally {
      setIsUpdating(false)
    }
  }

  const handleRate = (rating: number) => {
    if (rating === question.rating) return // No change
    handleUpdate({ rating })
  }

  const handleAddTag = () => {
    if (!newTag.trim()) return
    const currentTags = question.tags || []
    if (currentTags.includes(newTag.trim())) {
      toast.error('이미 존재하는 태그입니다')
      return
    }
    handleUpdate({ tags: [...currentTags, newTag.trim()] })
    setNewTag('')
    setIsTagPopoverOpen(false)
  }

  const handleRemoveTag = (tagToRemove: string) => {
    const currentTags = question.tags || []
    handleUpdate({ tags: currentTags.filter(t => t !== tagToRemove) })
  }

  return (
    <div className={`relative border-2 rounded-lg p-4 transition-all hover:border-gray-300 ${isSelected ? 'border-primary bg-primary/5 hover:border-primary' : 'border-transparent bg-white shadow-sm'}`}>
      <div className="absolute top-2 left-2 z-10">
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => onSelect(checked as boolean)}
        />
      </div>
      
      {/* Header Badges */}
      <div className="absolute top-2 right-2 z-10 flex gap-1.5 flex-wrap justify-end max-w-[400px] items-start">
        <Badge
          variant="secondary"
          className="rounded-full text-xs shadow-sm bg-violet-50 border-violet-200 text-violet-800"
        >
{question.problem_types?.type_name || '미분류'}
        </Badge>
        <div className="flex items-center gap-1 text-xs text-gray-500 bg-white/80 px-2 py-1 rounded backdrop-blur-sm border">
            <Calendar className="w-3 h-3" />
            {format(new Date(question.created_at), 'yyyy-MM-dd', { locale: ko })}
        </div>
        
        {/* Source Badges - from community questions */}
        {(question.source_type || question.source_1 || question.source_2 || question.source_3 || question.source_4) && (
          <div className="flex items-center gap-1.5 bg-white/80 p-1 rounded backdrop-blur-sm">
            {question.source_type && (
              <Badge variant="default" className="text-xs font-normal">
                {question.source_type}
              </Badge>
            )}
            {question.source_1 && (
              <Badge variant="outline" className="text-xs bg-gray-50 text-gray-700 border-gray-200">
                {question.source_1}
              </Badge>
            )}
            {question.source_2 && (
              <Badge variant="outline" className="text-xs bg-gray-50 text-gray-700 border-gray-200">
                {question.source_2}
              </Badge>
            )}
            {question.source_3 && (
              <Badge variant="outline" className="text-xs bg-gray-50 text-gray-700 border-gray-200">
                {question.source_3}
              </Badge>
            )}
            {question.source_4 && (
              <Badge variant="outline" className="text-xs bg-gray-50 text-gray-700 border-gray-200">
                {question.source_4}
              </Badge>
            )}
          </div>
        )}

        {question.difficulty && (
          <Badge variant="outline" className="text-xs bg-orange-50 border-orange-200">
            {getDifficultyLabel(question.difficulty)}
          </Badge>
        )}
      </div>

      <div className="ml-8 pt-8"> 
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {/* Rating */}
          <div className="flex items-center gap-1">
            {[1, 2, 3].map((star) => (
              <button
                key={star}
                onClick={() => handleRate(question.rating === star ? 0 : star)} 
                disabled={isUpdating}
                className={`transition-colors focus:outline-none ${
                  (question.rating || 0) >= star 
                  ? 'text-yellow-400 fill-yellow-400' 
                  : 'text-gray-300 hover:text-yellow-200'
                }`}
              >
                <Star className={`w-5 h-5 ${(question.rating || 0) >= star ? 'fill-current' : ''}`} />
              </button>
            ))}
          </div>

          {/* Tags area */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {(question.tags || []).map(tag => (
              <Badge key={tag} variant="outline" className="text-xs pl-2 pr-1 py-0.5 h-6 gap-1 group">
                {tag}
                <button 
                  onClick={(e) => { e.stopPropagation(); handleRemoveTag(tag); }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground rounded-full p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
            
            <Popover open={isTagPopoverOpen} onOpenChange={setIsTagPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 shrink-0 rounded-full border border-dashed p-0 hover:border-solid">
                  <Plus className="w-3 h-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-60 p-3" align="end">
                <div className="flex gap-2">
                  <Input 
                    value={newTag} 
                    onChange={(e) => setNewTag(e.target.value)} 
                    placeholder="태그 입력..."
                    className="h-8 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddTag()
                    }}
                  />
                  <Button size="sm" onClick={handleAddTag} className="h-8 px-2">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <QuestionPreview
          question={{
            questionText: question.question_text,
            questionTextForward: question.question_text_forward,
            questionTextBackward: question.question_text_backward,
            passageText: question.passage_text,
            choices: question.choices,
            answer: question.answer,
            explanation: question.explanation,
          }}
          showCard={false}
          showSaveButton={false}
        />
      </div>
    </div>
  )
}

// --- Action Bar Component ---
interface QuestionActionBarProps {
    selectedCount: number
    totalCount: number
    scale: number
    onScaleChange: (scale: number) => void
    onSelectAll: () => void
    onCreateExamPaper: () => void
    onDeleteSelected?: () => void
}

export function QuestionActionBar({
    selectedCount,
    totalCount,
    scale,
    onScaleChange,
    onSelectAll,
    onCreateExamPaper,
    onDeleteSelected
}: QuestionActionBarProps) {

    const adjustScale = (delta: number) => {
        const newScale = Math.min(Math.max(scale + delta, 50), 150)
        onScaleChange(newScale)
    }

    return (
        <div className="py-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7"
                        onClick={onSelectAll}
                    >
                        {selectedCount > 0 && selectedCount === totalCount ? '전체 해제' : '전체 선택'}
                    </Button>
                    <span className="text-xs text-gray-600">
                        {selectedCount}개 선택됨
                    </span>

                    {/* Zoom Slider Control */}
                    <div className="flex items-center gap-2 ml-3 pl-3 border-l">
                        <span className="text-xs font-medium w-12 text-center">{scale}%</span>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded-full"
                            onClick={() => adjustScale(-10)}
                            disabled={scale <= 50}
                        >
                            <Minus className="h-3 w-3" />
                        </Button>

                        <input
                            type="range"
                            min="50"
                            max="150"
                            step="10"
                            value={scale}
                            onChange={(e) => onScaleChange(Number(e.target.value))}
                            className="w-24 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary"
                        />

                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded-full"
                            onClick={() => adjustScale(10)}
                            disabled={scale >= 150}
                        >
                            <Plus className="h-3 w-3" />
                        </Button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {onDeleteSelected && (
                        <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                            onClick={onDeleteSelected}
                            disabled={selectedCount === 0}
                        >
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            선택 삭제
                        </Button>
                    )}
                    <Button
                        size="sm"
                        className="text-xs h-7"
                        onClick={onCreateExamPaper}
                        disabled={selectedCount === 0}
                    >
                        선택한 문제로 시험지 만들기
                    </Button>
                </div>
            </div>
        </div>
    )
}

// --- Grid Component ---
interface QuestionGridProps {
    questions: DBQuestion[]
    selectedQuestionIds: string[]
    onSelectQuestion: (questionId: string, checked: boolean) => void
    scale: number
    workspaceSubject: WorkspaceSubject
}

export function QuestionGrid({
    questions,
    selectedQuestionIds,
    onSelectQuestion,
    scale,
    workspaceSubject
}: QuestionGridProps) {

    // Calculate transform and layout adjustments
    const s = scale / 100
    const transformStyle = {
        transform: `scale(${s})`,
        transformOrigin: 'top left',
        width: `${100 / s}%`,
        marginBottom: `${(s - 1) * 100}%`
    }

    if (!questions || questions.length === 0) {
        return (
            <div className="text-center py-10 text-gray-500">
                저장된 문제가 없습니다. &apos;문제 생성&apos; 페이지에서 문제를 만들어보세요!
            </div>
        )
    }

    return (
        <div
            className="grid gap-6 md:grid-cols-1 lg:grid-cols-2"
            style={transformStyle}
        >
            {questions.map((q) => (
                <QuestionItem
                    key={q.id}
                    question={q}
                    isSelected={selectedQuestionIds.includes(q.id)}
                    onSelect={(checked) => onSelectQuestion(q.id, checked)}
                    workspaceSubject={workspaceSubject}
                />
            ))}
        </div>
    )
}

// --- Exam Paper Dialog Component ---
// This is now just a purely presentational dialog, or we can keep the logic inside if we pass props.
// Ideally, the parent should handle the dialog state too, but to minimize refactoring, we can keep it here
// IF we export it. But `QuestionList` was previously handling it. 
// Let's create a separate exported component for the Dialog to keep things clean and composable.

interface CreateExamDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    selectedCount: number
    onConfirm: (title: string, description: string) => Promise<void>
}

export function CreateExamDialog({ open, onOpenChange, selectedCount, onConfirm }: CreateExamDialogProps) {
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [isCreating, setIsCreating] = useState(false)

    const handleCreate = async () => {
        setIsCreating(true)
        try {
            await onConfirm(title, description)
            setTitle('')
            setDescription('')
            onOpenChange(false)
        } catch {
            // Error handling should be done by parent or here if onConfirm throws
        } finally {
            setIsCreating(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>시험지 만들기</DialogTitle>
                    <DialogDescription>
                        선택한 {selectedCount}개의 문제로 시험지를 생성합니다.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="title">시험지 제목 *</Label>
                        <Input
                            id="title"
                            placeholder="예: 2025학년도 1학기 중간고사"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="description">설명</Label>
                        <Textarea
                            id="description"
                            placeholder="시험지에 대한 설명을 입력하세요 (선택사항)"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>
                </div>
                <DialogFooter className="justify-center gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        취소
                    </Button>
                    <Button onClick={handleCreate} disabled={isCreating}>
                        {isCreating ? '생성 중...' : '시험지 생성'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export function QuestionList({
  questions,
  workspaceSubject = DEFAULT_WORKSPACE_SUBJECT,
}: {
  questions: DBQuestion[]
  workspaceSubject?: WorkspaceSubject
}) {
  const router = useRouter()
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([])
  const [scale, setScale] = useState(100)
  const [isExamDialogOpen, setIsExamDialogOpen] = useState(false)

  const handleSelectQuestion = (questionId: string, checked: boolean) => {
    if (checked) {
      setSelectedQuestionIds(prev => [...prev, questionId])
    } else {
      setSelectedQuestionIds(prev => prev.filter(id => id !== questionId))
    }
  }

  const handleSelectAll = () => {
    if (selectedQuestionIds.length === questions.length) {
      setSelectedQuestionIds([])
    } else {
      setSelectedQuestionIds(questions.map(q => q.id))
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

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || 'Failed to create exam paper')
      }

      toast.success('시험지가 생성되었습니다')
      router.push(`/library/exam-papers/${data.data.id}?subject=${workspaceSubject}`)
      setSelectedQuestionIds([])
    } catch (error) {
        console.error(error)
        toast.error('시험지 생성에 실패했습니다')
        throw error
    }
  }

  return (
    <div className="space-y-6">
      <QuestionActionBar
        selectedCount={selectedQuestionIds.length}
        totalCount={questions.length}
        scale={scale}
        onScaleChange={setScale}
        onSelectAll={handleSelectAll}
        onCreateExamPaper={() => setIsExamDialogOpen(true)}
      />

      <QuestionGrid
        questions={questions}
        selectedQuestionIds={selectedQuestionIds}
        onSelectQuestion={handleSelectQuestion}
        scale={scale}
        workspaceSubject={workspaceSubject}
      />

      <CreateExamDialog
        open={isExamDialogOpen}
        onOpenChange={setIsExamDialogOpen}
        selectedCount={selectedQuestionIds.length}
        onConfirm={handleCreateExamPaper}
      />
    </div>
  )
}
