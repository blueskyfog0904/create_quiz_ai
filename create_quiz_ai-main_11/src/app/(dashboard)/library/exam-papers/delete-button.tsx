'use client'

import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface DeleteExamPaperButtonProps {
  paperId: string
}

export function DeleteExamPaperButton({ paperId }: DeleteExamPaperButtonProps) {
  const router = useRouter()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!confirm('정말로 이 문제지를 삭제하시겠습니까?')) {
      return
    }

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/exam-papers/${paperId}`, {
        method: 'DELETE'
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error?.message || '삭제에 실패했습니다.')
      }

      toast.success('문제지가 삭제되었습니다.')
      router.refresh()
    } catch (error: any) {
      console.error('Delete error:', error)
      toast.error(error.message)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Button
      variant="destructive"
      onClick={handleDelete}
      disabled={isDeleting}
    >
      {isDeleting ? '삭제 중...' : '삭제'}
    </Button>
  )
}


