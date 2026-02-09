'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Plus, Pencil, Trash2, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import { createRole, updateRole, deleteRole } from './actions'

interface UserRole {
    id: string
    value: string
    label: string
    sort_order: number
    is_active: boolean
    created_at: string
    updated_at: string
}

interface RolesClientProps {
    initialRoles: UserRole[]
}

export function RolesClient({ initialRoles }: RolesClientProps) {
    const [roles, setRoles] = useState<UserRole[]>(initialRoles)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
    const [editingRole, setEditingRole] = useState<UserRole | null>(null)
    const [roleToDelete, setRoleToDelete] = useState<UserRole | null>(null)
    const [isLoading, setIsLoading] = useState(false)

    // Form state
    const [formValue, setFormValue] = useState('')
    const [formLabel, setFormLabel] = useState('')
    const [formSortOrder, setFormSortOrder] = useState(0)
    const [formIsActive, setFormIsActive] = useState(true)

    const openCreateDialog = () => {
        setEditingRole(null)
        setFormValue('')
        setFormLabel('')
        setFormSortOrder(roles.length > 0 ? Math.max(...roles.map(r => r.sort_order)) + 1 : 1)
        setFormIsActive(true)
        setIsDialogOpen(true)
    }

    const openEditDialog = (role: UserRole) => {
        setEditingRole(role)
        setFormValue(role.value)
        setFormLabel(role.label)
        setFormSortOrder(role.sort_order)
        setFormIsActive(role.is_active)
        setIsDialogOpen(true)
    }

    const openDeleteDialog = (role: UserRole) => {
        setRoleToDelete(role)
        setIsDeleteDialogOpen(true)
    }

    const handleSubmit = async () => {
        if (!formValue.trim() || !formLabel.trim()) {
            toast.error('모든 필드를 입력해주세요.')
            return
        }

        setIsLoading(true)
        try {
            if (editingRole) {
                // Update
                const result = await updateRole(editingRole.id, {
                    value: formValue,
                    label: formLabel,
                    sort_order: formSortOrder,
                    is_active: formIsActive
                })

                if (result.error) {
                    throw new Error(result.error)
                }

                setRoles(roles.map(r =>
                    r.id === editingRole.id
                        ? { ...r, value: formValue, label: formLabel, sort_order: formSortOrder, is_active: formIsActive }
                        : r
                ).sort((a, b) => a.sort_order - b.sort_order))

                toast.success('역할이 수정되었습니다.')
            } else {
                // Create
                const result = await createRole({
                    value: formValue,
                    label: formLabel,
                    sort_order: formSortOrder,
                    is_active: formIsActive
                })

                if (result.error) {
                    throw new Error(result.error)
                }

                if (result.data) {
                    setRoles([...roles, result.data].sort((a, b) => a.sort_order - b.sort_order))
                }

                toast.success('역할이 추가되었습니다.')
            }

            setIsDialogOpen(false)
        } catch (error: any) {
            toast.error(error.message || '처리 중 오류가 발생했습니다.')
        } finally {
            setIsLoading(false)
        }
    }

    const handleDelete = async () => {
        if (!roleToDelete) return

        setIsLoading(true)
        try {
            const result = await deleteRole(roleToDelete.id)

            if (result.error) {
                throw new Error(result.error)
            }

            setRoles(roles.filter(r => r.id !== roleToDelete.id))
            toast.success('역할이 삭제되었습니다.')
            setIsDeleteDialogOpen(false)
        } catch (error: any) {
            toast.error(error.message || '삭제 중 오류가 발생했습니다.')
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="space-y-4">
            {/* Add Button */}
            <div className="flex justify-end">
                <Button onClick={openCreateDialog} className="gap-2">
                    <Plus className="h-4 w-4" />
                    역할 추가
                </Button>
            </div>

            {/* Roles List */}
            <Card className="border-0 shadow-sm">
                <CardContent className="p-0">
                    {roles.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">
                            등록된 역할이 없습니다.
                        </div>
                    ) : (
                        <div className="divide-y">
                            {roles.map((role) => (
                                <div
                                    key={role.id}
                                    className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                                >
                                    <div className="flex items-center gap-4">
                                        <GripVertical className="h-5 w-5 text-gray-300" />
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-gray-900">{role.label}</span>
                                                <Badge variant="outline" className="text-xs font-mono">
                                                    {role.value}
                                                </Badge>
                                                {!role.is_active && (
                                                    <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-500">
                                                        비활성
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="text-sm text-gray-500 mt-0.5">
                                                정렬 순서: {role.sort_order}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => openEditDialog(role)}
                                            className="h-8 w-8"
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => openDeleteDialog(role)}
                                            className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Create/Edit Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingRole ? '역할 수정' : '역할 추가'}</DialogTitle>
                        <DialogDescription>
                            회원가입 시 선택할 수 있는 역할을 {editingRole ? '수정' : '추가'}합니다.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="value">저장값 (영문)</Label>
                            <Input
                                id="value"
                                value={formValue}
                                onChange={(e) => setFormValue(e.target.value)}
                                placeholder="예: parent, student, instructor"
                                disabled={!!editingRole}
                            />
                            <p className="text-xs text-gray-500">
                                DB에 저장되는 값입니다. 생성 후에는 수정할 수 없습니다.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="label">표시명 (한글)</Label>
                            <Input
                                id="label"
                                value={formLabel}
                                onChange={(e) => setFormLabel(e.target.value)}
                                placeholder="예: 학부모, 학생, 강사"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="sortOrder">정렬 순서</Label>
                            <Input
                                id="sortOrder"
                                type="number"
                                value={formSortOrder}
                                onChange={(e) => setFormSortOrder(Number(e.target.value))}
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <Label htmlFor="isActive">활성화</Label>
                            <Switch
                                id="isActive"
                                checked={formIsActive}
                                onCheckedChange={setFormIsActive}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                            취소
                        </Button>
                        <Button onClick={handleSubmit} disabled={isLoading}>
                            {isLoading ? '처리 중...' : (editingRole ? '수정' : '추가')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>역할 삭제</AlertDialogTitle>
                        <AlertDialogDescription>
                            <strong>{roleToDelete?.label}</strong> 역할을 삭제하시겠습니까?
                            <br />
                            <span className="text-red-600">
                                이 역할을 가진 기존 사용자의 역할 정보는 그대로 유지됩니다.
                            </span>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            className="bg-red-600 hover:bg-red-700"
                            disabled={isLoading}
                        >
                            {isLoading ? '삭제 중...' : '삭제'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
