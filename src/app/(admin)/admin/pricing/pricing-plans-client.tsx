'use client'

import { useState, useEffect } from 'react'
import { PricingPlan, getPricingPlans, togglePlanStatus } from './actions'
import { Button } from '@/components/ui/button'
import { Plus, Pencil } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { PricingPlanDialog } from './components/pricing-plan-dialog'
import { AdminConfirmDialog } from '@/components/admin/kit/admin-confirm-dialog'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { formatCredits, formatWon } from '@/lib/admin-format'
import { adminStatusTone } from '@/lib/admin-status-tone'
import { toast } from 'sonner'

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

    // 판매 상태는 바꾸는 즉시 고객의 충전 화면에 반영된다. 스위치를 눌러도 바로 바꾸지 않고 확인 창을 거친다.
    const [toggleTarget, setToggleTarget] = useState<PricingPlan | null>(null)
    const [toggling, setToggling] = useState(false)

    const handleConfirmToggle = async () => {
        if (!toggleTarget) return
        const nextActive = !toggleTarget.is_active
        setToggling(true)
        try {
            await togglePlanStatus(toggleTarget.id, nextActive)
            toast.success(`'${toggleTarget.name}' 요금제를 ${nextActive ? '판매중' : '비활성'}으로 바꿨습니다.`)
            setToggleTarget(null)
        } catch (err) {
            console.error(err)
            toast.error('판매 상태를 바꾸지 못했습니다. 목록의 현재 상태를 확인해 주세요.')
        } finally {
            setToggling(false)
            // 성공·실패와 무관하게 DB의 실제 상태를 다시 읽어 보여 준다.
            fetchPlans()
        }
    }

    const handleSuccess = () => {
        fetchPlans()
    }

    if (loading && plans.length === 0) {
        return <AdminTableState kind="loading" className="h-64" />
    }

    if (error) {
        return <AdminTableState kind="error" message={error} onRetry={fetchPlans} />
    }

    const columns: AdminDataTableColumn<PricingPlan>[] = [
        { key: 'sort_order', header: '순서', numeric: true, headerClassName: 'w-[80px]', cell: (plan) => plan.sort_order },
        {
            key: 'name',
            header: '상품명',
            className: 'font-medium',
            cell: (plan) => (
                <>
                    {plan.name}
                    {plan.description && (
                        <p className="text-xs font-normal text-[var(--studio-muted)] truncate max-w-[200px]">{plan.description}</p>
                    )}
                </>
            ),
        },
        { key: 'credits', header: '크레딧', numeric: true, cell: (plan) => formatCredits(plan.credits) },
        { key: 'price', header: '가격', numeric: true, cell: (plan) => formatWon(plan.price) },
        {
            key: 'display',
            header: '화면 표시',
            className: 'text-xs text-[var(--studio-text)]',
            cell: (plan) => (
                <>
                    <p>배지: {plan.badge_text || '없음'}</p>
                    <p>강조: {plan.is_highlighted ? '예' : '아니오'}</p>
                    <p>할인·혜택: {plan.discount_text || '없음'}</p>
                </>
            ),
        },
        {
            key: 'status',
            header: '상태',
            cell: (plan) => (
                <div className="flex items-center gap-2">
                    <Switch
                        checked={plan.is_active}
                        aria-label={`${plan.name} 판매 상태`}
                        onCheckedChange={() => setToggleTarget(plan)}
                    />
                    <AdminStatusBadge
                        label={plan.is_active ? '판매중' : '비활성'}
                        tone={adminStatusTone('pricingPlan', plan.is_active ? 'active' : 'inactive')}
                    />
                </div>
            ),
        },
        {
            key: 'manage',
            header: '관리',
            align: 'right',
            cell: (plan) => (
                <Button variant="adminTable" size="sm" aria-label={`${plan.name} 수정`} onClick={() => handleEdit(plan)}>
                    <Pencil className="h-4 w-4" />
                </Button>
            ),
        },
    ]

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap justify-between items-center gap-3">
                <h2 className="text-xl font-semibold text-[var(--studio-ink)]">요금제 목록</h2>
                <Button variant="brand" onClick={handleCreate}>
                    <Plus className="h-4 w-4 mr-2" />
                    새 요금제 추가
                </Button>
            </div>

            <AdminDataTable
                caption="요금제 목록"
                columns={columns}
                rows={plans}
                getRowKey={(plan) => plan.id}
                minWidth={720}
                state={plans.length === 0 ? <AdminTableState kind="empty" message="등록된 요금제가 없습니다." /> : undefined}
            />

            <AdminConfirmDialog
                open={toggleTarget !== null}
                onOpenChange={(open) => !open && !toggling && setToggleTarget(null)}
                title={toggleTarget?.is_active ? '요금제 판매 중지' : '요금제 판매 시작'}
                description={
                    toggleTarget?.is_active
                        ? '중지하면 고객의 충전 화면에서 이 요금제가 바로 사라지고 새로 결제할 수 없습니다. 이미 결제한 건에는 영향이 없습니다.'
                        : '시작하면 고객의 충전 화면에 이 요금제가 바로 나타나고 누구나 결제할 수 있습니다.'
                }
                impacts={
                    toggleTarget
                        ? [
                              { label: '요금제', value: toggleTarget.name, emphasis: true },
                              { label: '가격', value: formatWon(toggleTarget.price), emphasis: true },
                              { label: '크레딧', value: formatCredits(toggleTarget.credits) },
                          ]
                        : undefined
                }
                confirmLabel={toggleTarget?.is_active ? '판매 중지' : '판매 시작'}
                danger={Boolean(toggleTarget?.is_active)}
                pending={toggling}
                onConfirm={handleConfirmToggle}
            />

            <PricingPlanDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                planToEdit={selectedPlan}
                onSuccess={handleSuccess}
            />
        </div>
    )
}
