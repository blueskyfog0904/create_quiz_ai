'use client'

import { useState } from 'react'
import { createProblemType, updateProblemType, deleteProblemType } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Database } from '@/types/supabase'

type ProblemType = Database['public']['Tables']['problem_types']['Row']

interface ProblemTypesClientProps {
  initialTypes: ProblemType[]
}

export default function ProblemTypesClient({ initialTypes }: ProblemTypesClientProps) {
  const [types, setTypes] = useState<ProblemType[]>(initialTypes)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingType, setEditingType] = useState<ProblemType | null>(null)

  // We rely on revalidatePath from server actions to refresh data, 
  // but we might want to optimistically update or just wait for server refresh.
  // Since we passed initialTypes from server component, updating the DB via action 
  // and then relying on Next.js router refresh is the standard way.
  // But passing initialTypes as prop means it won't update automatically on action completion unless we use router.refresh().
  // I'll import useRouter.

  // Actually, simpler: just accept types as prop and let the parent server component handle fetching. 
  // When action completes, revalidatePath triggers page re-render on server, sending new props.
  
  // Wait, in Next.js App Router, revalidatePath re-runs the server component, 
  // but client component state (like 'types' if initialized in state) might not reset unless we use a key or useEffect.
  // Better to use the prop directly if possible, or useEffect to sync.
  // Or just use `types` from props directly and don't keep local state for the list.

  const handleCreate = async (formData: FormData) => {
    const result = await createProblemType(null, formData)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success("Problem type created")
      setIsDialogOpen(false)
    }
  }

  const handleUpdate = async (formData: FormData) => {
    if (!editingType) return
    const result = await updateProblemType(editingType.id, null, formData)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success("Problem type updated")
      setEditingType(null)
      setIsDialogOpen(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this type?")) return
    const result = await deleteProblemType(id)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success("Problem type deleted")
    }
  }

  const openEdit = (type: ProblemType) => {
    setEditingType(type)
    setIsDialogOpen(true)
  }

  const openCreate = () => {
    setEditingType(null)
    setIsDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Registered Types</h2>
        <Button onClick={openCreate}>Add New Type</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {initialTypes.map((type) => (
          <Card key={type.id}>
            <CardHeader>
              <CardTitle className="flex justify-between">
                <span>{type.type_name}</span>
                <span className={`text-xs px-2 py-1 rounded ${type.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {type.is_active ? 'Active' : 'Inactive'}
                </span>
              </CardTitle>
              <CardDescription>{type.provider} / {type.model_name}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500 line-clamp-2 mb-4">{type.description}</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(type)}>Edit</Button>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(type.id)}>Delete</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open)
        if (!open) setEditingType(null)
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingType ? 'Edit Problem Type' : 'Create Problem Type'}</DialogTitle>
            <DialogDescription>
              Define the AI prompt and settings for this question type.
            </DialogDescription>
          </DialogHeader>
          
          <form action={editingType ? handleUpdate : handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="type_name">Type Name</Label>
                    <Input id="type_name" name="type_name" defaultValue={editingType?.type_name} required />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="is_active">Status</Label>
                    <div className="flex items-center space-x-2 h-10">
                        <input type="checkbox" id="is_active" name="is_active" defaultChecked={editingType?.is_active ?? true} className="h-4 w-4" />
                        <label htmlFor="is_active">Active</label>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input id="description" name="description" defaultValue={editingType?.description || ''} />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="provider">AI Provider</Label>
                    <Select name="provider" defaultValue={editingType?.provider || 'openai'}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="openai">OpenAI</SelectItem>
                            <SelectItem value="gemini">Gemini</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="model_name">Model Name</Label>
                    <Input id="model_name" name="model_name" defaultValue={editingType?.model_name || 'gpt-4o'} placeholder="gpt-4o, gemini-pro..." required />
                </div>
            </div>

            <div className="space-y-2">
                <Label htmlFor="prompt_template">Prompt Template</Label>
                <Textarea 
                    id="prompt_template" 
                    name="prompt_template" 
                    className="font-mono text-sm min-h-[200px]" 
                    placeholder="You are an expert... {{PASSAGE}}..." 
                    defaultValue={editingType?.prompt_template}
                    required 
                />
                <p className="text-xs text-gray-500">Available variables: {"{{PASSAGE}}, {{GRADE_LEVEL}}, {{DIFFICULTY}}"}</p>
            </div>

            <DialogFooter>
                <Button type="submit">{editingType ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

