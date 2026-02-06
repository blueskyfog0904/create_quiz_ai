'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { 
  Search, 
  Coins, 
  ArrowUpRight, 
  ArrowDownLeft, 
  RotateCcw,
  Filter,
  Download,
  Calendar
} from 'lucide-react'
import { GrantCreditDialog } from './grant-credit-dialog'

type Transaction = {
  id: string
  amount: number
  transaction_type: string
  description: string
  created_at: string
  resource_type: string | null
  resource_id: string | null
  user: {
    email: string | null
    name: string | null
  } | null
}

interface CreditsClientProps {
  initialTransactions: Transaction[]
  totalCount: number
  stats: {
    totalGrant: number
    totalConsume: number
    totalRefund: number
  }
}

export function CreditsClient({ initialTransactions, totalCount, stats }: CreditsClientProps) {
  const [transactions] = useState<Transaction[]>(initialTransactions)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [isGrantDialogOpen, setIsGrantDialogOpen] = useState(false)

  const filteredTransactions = transactions.filter(t => {
    const searchLower = search.toLowerCase()
    
    // Search filter
    const matchesSearch = 
      t.user?.email?.toLowerCase().includes(searchLower) ||
      t.user?.name?.toLowerCase().includes(searchLower) ||
      t.description.toLowerCase().includes(searchLower)

    // Type filter
    let matchesType = true
    if (typeFilter !== 'all') {
      if (typeFilter === 'grant') matchesType = t.amount > 0 && t.transaction_type !== 'system_refund'
      if (typeFilter === 'consume') matchesType = t.amount < 0
      if (typeFilter === 'refund') matchesType = t.transaction_type === 'system_refund'
    }

    return matchesSearch && matchesType
  })

  const getTypeBadge = (amount: number, type: string) => {
    if (type === 'system_refund') {
      return <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100">환불 (System)</Badge>
    }
    if (amount > 0) {
        return <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100">지급 (Grant)</Badge>
    }
    return <Badge variant="secondary" className="bg-gray-100 text-gray-700 hover:bg-gray-100">사용 (Consume)</Badge>
  }

  const getAmountColor = (amount: number, type: string) => {
    if (type === 'system_refund') return 'text-blue-600'
    return amount > 0 ? 'text-green-600' : 'text-red-600'
  }

  const handleRefresh = () => {
    window.location.reload()
  }

  return (
    <div className="space-y-6">
      <GrantCreditDialog 
        open={isGrantDialogOpen} 
        onOpenChange={setIsGrantDialogOpen}
        onSuccess={handleRefresh}
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">총 지급액</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700">+{stats.totalGrant.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">관리자 지급 및 이벤트</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">총 소비액</CardTitle>
            <ArrowDownLeft className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-700">{stats.totalConsume.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">문제 생성 및 가져오기</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">총 환불액</CardTitle>
            <RotateCcw className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-700">+{stats.totalRefund.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">시스템 자동 환불</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters & Actions */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white p-4 rounded-lg border shadow-sm">
        <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                    placeholder="사용자명, 이메일, 내역 검색..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[140px]">
                    <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-gray-500" />
                        <SelectValue />
                    </div>
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">전체 내역</SelectItem>
                    <SelectItem value="consume">사용 내역</SelectItem>
                    <SelectItem value="grant">지급 내역</SelectItem>
                    <SelectItem value="refund">환불 내역</SelectItem>
                </SelectContent>
            </Select>
        </div>
        <div className="flex items-center gap-2">
            <Button 
                onClick={() => setIsGrantDialogOpen(true)} 
                className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
            >
                <Coins className="h-4 w-4" />
                크레딧 지급
            </Button>
            <Button variant="outline" size="sm" className="gap-2">
                <Download className="h-4 w-4" />
                엑셀 다운로드
            </Button>
        </div>
      </div>

      {/* Transaction Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>일시</TableHead>
                <TableHead>사용자</TableHead>
                <TableHead>유형</TableHead>
                <TableHead>내용</TableHead>
                <TableHead className="text-right">금액</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    거래 내역이 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                filteredTransactions.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs text-gray-500">
                        <div className="flex items-center gap-2">
                            <Calendar className="h-3 w-3" />
                            {new Date(t.created_at).toLocaleString('ko-KR')}
                        </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-sm">{t.user?.name || '알 수 없음'}</span>
                        <span className="text-xs text-gray-400">{t.user?.email || '-'}</span>
                      </div>
                    </TableCell>
                    <TableCell>{getTypeBadge(t.amount, t.transaction_type)}</TableCell>
                    <TableCell>
                        <div className="text-sm">{t.description}</div>
                        {t.resource_type && (
                            <div className="text-xs text-gray-400 mt-0.5">
                                {t.resource_type} #{t.resource_id?.slice(0, 8)}
                            </div>
                        )}
                    </TableCell>
                    <TableCell className={`text-right font-bold ${getAmountColor(t.amount, t.transaction_type)}`}>
                      {t.amount > 0 ? '+' : ''}{t.amount.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <div className="flex justify-center text-xs text-gray-400">
        최근 100건의 거래 내역만 표시됩니다 (전체 조회 기능 개발 예정)
      </div>
    </div>
  )
}
