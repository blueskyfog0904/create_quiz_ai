'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Loader2, Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface ProblemType {
  id: string
  type_name: string
}

interface AdminUploadClientProps {
  problemTypes: ProblemType[]
  gradeLevels: string[]
  difficulties: string[]
}

export default function AdminUploadClient({ problemTypes, gradeLevels, difficulties }: AdminUploadClientProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAddingProblemType, setIsAddingProblemType] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  
  const [formData, setFormData] = useState({
    question_text: '',
    passage_text: '',
    answer: '',
    choices: ['', '', '', '', ''], // 5개로 변경
    explanation: '',
    difficulty: undefined as string | undefined,
    grade_level: undefined as string | undefined,
    problem_type_id: '',
  })
  
  const [newProblemType, setNewProblemType] = useState({
    type_name: '',
    description: '',
    provider: 'admin' as 'gemini' | 'openai' | 'admin',
    prompt_template: '',
    model_name: '',
    output_format: '',
    is_active: true,
  })
  
  const handleChoiceChange = (index: number, value: string) => {
    const newChoices = [...formData.choices]
    newChoices[index] = value
    setFormData({ ...formData, choices: newChoices })
  }
  
  const addChoice = () => {
    setFormData({ ...formData, choices: [...formData.choices, ''] })
  }
  
  const removeChoice = (index: number) => {
    if (formData.choices.length <= 5) {
      toast.error('최소 5개의 선택지가 필요합니다.')
      return
    }
    const newChoices = formData.choices.filter((_, i) => i !== index)
    setFormData({ ...formData, choices: newChoices })
  }
  
  const handleAddProblemType = async () => {
    setIsAddingProblemType(true)
    
    try {
      // Validate
      if (!newProblemType.type_name.trim()) {
        throw new Error('문제 유형 이름을 입력해주세요.')
      }
      
      const response = await fetch('/api/admin/problem-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProblemType),
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '문제 유형 추가에 실패했습니다.')
      }
      
      toast.success('문제 유형이 성공적으로 추가되었습니다.')
      
      // Reset form and close dialog
      setNewProblemType({
        type_name: '',
        description: '',
        provider: 'admin',
        prompt_template: '',
        model_name: '',
        output_format: '',
        is_active: true,
      })
      setIsDialogOpen(false)
      
      // Refresh the page to show new problem type
      router.refresh()
      
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsAddingProblemType(false)
    }
  }
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    
    try {
      // Validate
      if (!formData.question_text.trim()) {
        throw new Error('문제 내용을 입력해주세요.')
      }
      if (!formData.answer.trim()) {
        throw new Error('정답을 입력해주세요.')
      }
      if (!formData.problem_type_id) {
        throw new Error('문제 유형을 선택해주세요.')
      }
      
      const validChoices = formData.choices.filter(c => c.trim())
      if (validChoices.length < 5) {
        throw new Error('5개의 선택지를 모두 입력해주세요.')
      }
      
      // Convert number labels to circled numbers
      const circledNumbers = ['①', '②', '③', '④', '⑤']
      
      // Format choices with circled numbers (AI format)
      const formattedChoices = validChoices.map((choice, index) => ({
        label: circledNumbers[index],
        text: choice
      }))
      
      // Convert answer (if it's a number 1-5, convert to circled number)
      let formattedAnswer = formData.answer.trim()
      const answerNum = parseInt(formattedAnswer)
      if (!isNaN(answerNum) && answerNum >= 1 && answerNum <= 5) {
        formattedAnswer = circledNumbers[answerNum - 1]
      }
      
      const response = await fetch('/api/admin/questions/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          choices: formattedChoices,
          answer: formattedAnswer,
          difficulty: formData.difficulty || undefined,
          grade_level: formData.grade_level || undefined,
          passage_text: formData.passage_text || undefined,
          explanation: formData.explanation || undefined,
        }),
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '문제 업로드에 실패했습니다.')
      }
      
      toast.success('문제가 성공적으로 업로드되었습니다.')
      
      // Reset form
      setFormData({
        question_text: '',
        passage_text: '',
        answer: '',
        choices: ['', '', '', '', ''], // 5개로 변경
        explanation: '',
        difficulty: undefined,
        grade_level: undefined,
        problem_type_id: '',
      })
      
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }
  
  return (
    <>
      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>문제 정보</CardTitle>
            <CardDescription>문제의 세부 정보를 입력하세요.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
          {/* Problem Type */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="problem_type_id">문제 유형 *</Label>
              <Button 
                type="button" 
                variant="outline" 
                size="sm"
                onClick={() => setIsDialogOpen(true)}
                className="text-primary"
              >
                <Plus className="h-4 w-4 mr-1" />
                문제 유형 추가
              </Button>
            </div>
            <Select 
              value={formData.problem_type_id} 
              onValueChange={(value) => setFormData({ ...formData, problem_type_id: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="문제 유형을 선택하세요" />
              </SelectTrigger>
              <SelectContent>
                {problemTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.type_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Passage Text */}
          <div className="space-y-2">
            <Label htmlFor="passage_text">지문 (선택)</Label>
            <Textarea
              id="passage_text"
              placeholder="영어 지문을 입력하세요..."
              value={formData.passage_text}
              onChange={(e) => setFormData({ ...formData, passage_text: e.target.value })}
              rows={6}
            />
          </div>
          
          {/* Question Text */}
          <div className="space-y-2">
            <Label htmlFor="question_text">문제 내용 *</Label>
            <Textarea
              id="question_text"
              placeholder="문제 내용을 입력하세요..."
              value={formData.question_text}
              onChange={(e) => setFormData({ ...formData, question_text: e.target.value })}
              rows={4}
              required
            />
          </div>
          
          {/* Choices */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>선택지 *</Label>
              <Button type="button" variant="outline" size="sm" onClick={addChoice}>
                <Plus className="h-4 w-4 mr-1" />
                선택지 추가
              </Button>
            </div>
            <div className="space-y-2">
              {formData.choices.map((choice, index) => {
                const circledNumbers = ['①', '②', '③', '④', '⑤']
                return (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder={`${circledNumbers[index]} 선택지 내용`}
                      value={choice}
                      onChange={(e) => handleChoiceChange(index, e.target.value)}
                    />
                    {formData.choices.length > 5 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeChoice(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          
          {/* Answer */}
          <div className="space-y-2">
            <Label htmlFor="answer">정답 * (1-5 숫자 또는 ①-⑤)</Label>
            <Input
              id="answer"
              placeholder="예: 3 또는 ③"
              value={formData.answer}
              onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
              required
            />
          </div>
          
          {/* Explanation */}
          <div className="space-y-2">
            <Label htmlFor="explanation">해설 (선택)</Label>
            <Textarea
              id="explanation"
              placeholder="해설을 입력하세요..."
              value={formData.explanation}
              onChange={(e) => setFormData({ ...formData, explanation: e.target.value })}
              rows={4}
            />
          </div>
          
          {/* Grade Level and Difficulty */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="grade_level">학년 (선택)</Label>
              <Select 
                value={formData.grade_level} 
                onValueChange={(value) => setFormData({ ...formData, grade_level: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="학년 선택" />
                </SelectTrigger>
                <SelectContent>
                  {gradeLevels.map((grade) => (
                    <SelectItem key={grade} value={grade}>
                      {grade}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="difficulty">난이도 (선택)</Label>
              <Select 
                value={formData.difficulty} 
                onValueChange={(value) => setFormData({ ...formData, difficulty: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="난이도 선택" />
                </SelectTrigger>
                <SelectContent>
                  {difficulties.map((difficulty) => (
                    <SelectItem key={difficulty} value={difficulty}>
                      {difficulty}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {/* Submit Button */}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              문제 업로드
            </Button>
          </div>
        </CardContent>
      </Card>
      </form>
      
      {/* Add Problem Type Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>문제 유형 추가</DialogTitle>
          <DialogDescription>
            관리자가 직접 업로드하는 문제의 유형을 추가합니다.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Type Name */}
          <div className="space-y-2">
            <Label htmlFor="type_name">문제 유형 이름 *</Label>
            <Input
              id="type_name"
              placeholder="예: 문장삽입형 문제"
              value={newProblemType.type_name}
              onChange={(e) => setNewProblemType({ ...newProblemType, type_name: e.target.value })}
            />
          </div>
          
          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">설명 (선택)</Label>
            <Textarea
              id="description"
              placeholder="문제 유형에 대한 간단한 설명"
              value={newProblemType.description}
              onChange={(e) => setNewProblemType({ ...newProblemType, description: e.target.value })}
              rows={3}
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isAddingProblemType}>
            취소
          </Button>
          <Button onClick={handleAddProblemType} disabled={isAddingProblemType}>
            {isAddingProblemType && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            문제 유형 추가
          </Button>
        </DialogFooter>
      </DialogContent>
      </Dialog>
    </>
  )
}

