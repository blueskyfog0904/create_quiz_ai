'use client'

import { Button } from '@/components/ui/button'
import { exportToPDF, exportToWord } from '@/lib/export-utils'
import { toast } from 'sonner'
import { useState } from 'react'
import type { ViewMode } from './exam-paper-view'

interface Choice {
  label: string
  text: string
}

interface Question {
  number: number
  questionText: string
  choices: Choice[]
  answer: string
  explanation: string
}

interface ExportButtonsProps {
  examPaper: {
    paper_title: string
    description?: string | null
  }
  questions: Question[]
  viewMode: ViewMode
}

export function ExportButtons({ examPaper, questions, viewMode }: ExportButtonsProps) {
  const [isExporting, setIsExporting] = useState(false)

  const handleExportPDF = async () => {
    setIsExporting(true)
    try {
      await exportToPDF({
        title: examPaper.paper_title,
        description: examPaper.description || undefined,
        questions,
        includeAnswers: viewMode === 'exam-with-answers'
      })
      toast.success('PDF 파일이 다운로드되었습니다.')
    } catch (error) {
      console.error('PDF export error:', error)
      toast.error('PDF 생성 중 오류가 발생했습니다.')
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportWord = async () => {
    setIsExporting(true)
    try {
      await exportToWord({
        title: examPaper.paper_title,
        description: examPaper.description || undefined,
        questions,
        includeAnswers: viewMode === 'exam-with-answers'
      })
      toast.success('Word 파일이 다운로드되었습니다.')
    } catch (error) {
      console.error('Word export error:', error)
      toast.error('Word 파일 생성 중 오류가 발생했습니다.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="mt-8 flex gap-4 justify-center">
      <Button 
        size="lg" 
        variant="outline"
        onClick={handleExportPDF}
        disabled={isExporting}
      >
        📄 {isExporting ? 'PDF 생성 중...' : 'PDF로 저장'}
      </Button>
      <Button 
        size="lg" 
        variant="outline"
        onClick={handleExportWord}
        disabled={isExporting}
      >
        📝 {isExporting ? 'Word 생성 중...' : 'Word로 저장'}
      </Button>
    </div>
  )
}

