'use client'

import { useState, useEffect } from 'react'
import { PricingPlan, getPricingPlans, togglePlanStatus } from './actions'
import { Button } from '@/components/ui/button'
import { Plus, Pencil, Loader2 } from 'lucide-react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { PricingPlanDialog } from './components/pricing-plan-dialog'

export function PricingPlansClient() {
    const [plans, setPlans] = useState<PricingPlan[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Dialog State
    const [dialogOpen, setDialogOpen] = useState(false)
    const [selectedPlan, setSelectedPlan] = useState<PricingPlan | null>(null)

    const fetchPlans = async () => {
        try {
            setLoading(true)
            const data = await getPricingPlans()
            setPlans(data)
            setError(null)
        } catch (err: any) {
            console.error(err)
            setError(err.message || '데이터를 불러오는데 실패했습니다.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchPlans()
    }, [])

    const handleCreate = () => {
        setSelectedPlan(null)
        setDialogOpen(true)
    }

    const handleEdit = (plan: PricingPlan) => {
        setSelectedPlan(plan)
        setDialogOpen(true)
    }

    const handleToggleActive = async (id: string, currentStatus: boolean) => {
        try {
            // Optimistic update
            setPlans(plans.map(p => p.id === id ? { ...p, is_active: !currentStatus } : p))
            await togglePlanStatus(id, !currentStatus)
        } catch (err) {
            console.error(err)
            // Revert on failure
            fetchPlans()
        }
    }

    const handleSuccess = () => {
        fetchPlans()
    }

    if (loading && plans.length === 0) {
        return (
            <div className="flex justify-center items-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="text-center py-12 text-red-500">
                <p>{error}</p>
                <Button onClick={fetchPlans} variant="outline" className="mt-4">다시 시도</Button>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-800">요금제 목록</h2>
                <Button onClick={handleCreate}>
                    <Plus className="h-4 w-4 mr-2" />
                    새 요금제 추가
                </Button>
            </div>

            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[80px]">순서</TableHead>
                            <TableHead>상품명</TableHead>
                            <TableHead>크레딧</TableHead>
                            <TableHead>가격</TableHead>
                            <TableHead>상태</TableHead>
                            <TableHead className="text-right">관리</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {plans.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center text-gray-500 py-8">
                                    등록된 요금제가 없습니다.
                                </TableCell>
                            </TableRow>
                        ) : (
                            plans.map((plan) => (
                                <TableRow key={plan.id}>
                                    <TableCell>{plan.sort_order}</TableCell>
                                    <TableCell className="font-medium">
                                        {plan.name}
                                        {plan.description && (
                                            <p className="text-xs text-gray-500 truncate max-w-[200px]">{plan.description}</p>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="secondary" className="font-mono">
                                            {plan.credits.toLocaleString()} C
                                        </Badge>
                                    </TableCell>
                                    <TableCell>₩{plan.price.toLocaleString()}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                checked={plan.is_active}
                                                onCheckedChange={() => handleToggleActive(plan.id, plan.is_active)}
                                            />
                                            <span className={`text-xs ${plan.is_active ? 'text-green-600' : 'text-gray-400'}`}>
                                                {plan.is_active ? '판매중' : '비활성'}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="sm" onClick={() => handleEdit(plan)}>
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            <PricingPlanDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                planToEdit={selectedPlan}
                onSuccess={handleSuccess}
            />
        </div>
    )
}
