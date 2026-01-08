'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Loader2, Pencil, Check, X } from 'lucide-react'
import { getDisplayLabels, updateDisplayLabel, DisplayLabel } from '@/app/api/admin/labels/actions'

export default function LabelsAdminPage() {
  const [labels, setLabels] = useState<DisplayLabel[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const fetchLabels = async () => {
    try {
      const data = await getDisplayLabels()
      setLabels(data)
    } catch (error) {
      toast.error('표기값을 불러오는데 실패했습니다')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchLabels()
  }, [])

  const handleEdit = (label: DisplayLabel) => {
    setEditingId(label.id)
    setEditValue(label.display_value)
  }

  const handleCancel = () => {
    setEditingId(null)
    setEditValue('')
  }

  const handleSave = async (id: string) => {
    try {
      const result = await updateDisplayLabel(id, editValue)
      if (result.success) {
        toast.success('저장되었습니다')
        fetchLabels()
      } else {
        toast.error(result.error || '저장에 실패했습니다')
      }
    } catch (error) {
      toast.error('저장에 실패했습니다')
    } finally {
      setEditingId(null)
      setEditValue('')
    }
  }

  // Group labels by category
  const groupedLabels = labels.reduce((acc, label) => {
    if (!acc[label.category]) {
      acc[label.category] = []
    }
    acc[label.category].push(label)
    return acc
  }, {} as Record<string, DisplayLabel[]>)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">표기값 관리</h1>
        <p className="text-gray-500 mt-1">화면에 표시되는 라벨 값을 관리합니다</p>
      </div>

      {Object.entries(groupedLabels).map(([category, categoryLabels]) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle className="text-lg">{category}</CardTitle>
            <CardDescription>DB 값에 대응하는 표시 값을 설정합니다</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {categoryLabels.map((label) => (
                <div key={label.id} className="flex items-center gap-4 py-2 border-b last:border-0">
                  <div className="w-32 text-sm text-gray-500 font-mono">{label.db_value}</div>
                  <div className="text-gray-400">→</div>
                  {editingId === label.id ? (
                    <div className="flex-1 flex items-center gap-2">
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="max-w-xs"
                      />
                      <Button size="icon" variant="ghost" onClick={() => handleSave(label.id)}>
                        <Check className="h-4 w-4 text-green-500" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={handleCancel}>
                        <X className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-between">
                      <span className="font-medium">{label.display_value}</span>
                      <Button size="icon" variant="ghost" onClick={() => handleEdit(label)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {labels.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-gray-500">
            등록된 표기값이 없습니다
          </CardContent>
        </Card>
      )}
    </div>
  )
}
