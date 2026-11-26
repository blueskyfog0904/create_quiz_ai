'use client'

import { useRouter } from 'next/navigation'
import { Bar, BarChart, CartesianGrid, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { trendYDomain } from '@/lib/admin-dashboard-fields'

// 21번 묶음 7절: 대시보드 그래프(Recharts, 대시보드에서만 next/dynamic 으로 늦게 불러온다).
// 자리는 화면이 고정 높이로 먼저 잡는다(넓은 그래프 280px, 도넛 240px). 값이 모두 0 이어도 축·기준선을 그리고 빈 상태 글을 겹쳐 보인다.
// 색만으로 구분하지 않는다: 도넛은 옆 범례에 이름·값을 글로 적고, 화면에 [표로 보기]가 있다(주 막대 이동 링크도 표에 있다).
// 그래프 영역은 role="img" 한 덩어리로 읽히게 하고, Recharts 키보드 초점 층(accessibilityLayer)은 끈다(img 안에 초점 요소가 생기지 않게).

export interface TrendPoint {
  key: string
  label: string
  value: number
  // 주 막대를 누르면 갈 주문 화면(권한 있을 때만 화면이 채운다)
  href?: string
}

export function DashboardTrendChart({
  points,
  formatValue,
  ariaLabel,
  emptyText,
}: {
  points: TrendPoint[]
  formatValue: (value: number) => string
  ariaLabel: string
  emptyText: string | null
}) {
  const router = useRouter()
  const empty = points.every((point) => point.value === 0)
  return (
    <div className="relative h-[280px] w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} stroke="var(--studio-border)" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--studio-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--studio-border)' }} minTickGap={12} />
          <YAxis
            width={64}
            tick={{ fontSize: 11, fill: 'var(--studio-muted)' }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            domain={trendYDomain(points.map((point) => point.value))}
            tickFormatter={(value: number) => formatValue(value)}
          />
          <ReferenceLine y={0} stroke="var(--studio-control-border)" ifOverflow="extendDomain" />
          {empty ? null : (
            <Tooltip
              cursor={{ fill: 'var(--studio-primary-soft)' }}
              formatter={(value) => formatValue(Number(value))}
              labelStyle={{ color: 'var(--studio-ink)' }}
            />
          )}
          <Bar
            dataKey="value"
            name="값"
            fill="var(--studio-primary)"
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
            cursor={points.some((point) => point.href) ? 'pointer' : undefined}
            onClick={(item) => {
              const href = (item?.payload as TrendPoint | undefined)?.href
              if (href) router.push(href)
            }}
          />
        </BarChart>
      </ResponsiveContainer>
      {empty && emptyText ? (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-[var(--studio-muted)]">{emptyText}</p>
      ) : null}
    </div>
  )
}

export interface DonutSlice {
  key: string
  label: string
  value: number
  color: string
}

export function DashboardDonutChart({
  slices,
  formatValue,
  ariaLabel,
  emptyText,
}: {
  slices: DonutSlice[]
  formatValue: (value: number) => string
  ariaLabel: string
  emptyText: string
}) {
  const shown = slices.filter((slice) => slice.value > 0)
  const empty = shown.length === 0
  // 모두 0 이면 회색 고리 + '데이터 없음'
  const data = empty
    ? [{ key: 'empty', label: emptyText, value: 1, fill: 'var(--admin-tone-neutral-border)' }]
    : shown.map((slice) => ({ key: slice.key, label: slice.label, value: slice.value, fill: slice.color }))
  return (
    <div className="flex h-[240px] w-full items-center gap-3">
      <div className="relative h-full min-w-0 flex-1" role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart accessibilityLayer={false}>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="88%" stroke="var(--studio-surface)" isAnimationActive={false} />
            {empty ? null : <Tooltip formatter={(value) => formatValue(Number(value))} />}
          </PieChart>
        </ResponsiveContainer>
        {empty ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-[var(--studio-muted)]">{emptyText}</p>
        ) : null}
      </div>
      {empty ? null : (
        <ul className="w-36 shrink-0 space-y-1.5 text-xs">
          {shown.map((slice) => (
            <li key={slice.key} className="flex items-start gap-1.5">
              <span aria-hidden="true" className="mt-1 inline-block size-2.5 shrink-0 rounded-sm" style={{ background: slice.color }} />
              <span className="min-w-0 break-keep">
                <span className="block text-[var(--studio-text)]">{slice.label}</span>
                <span className="block tabular-nums text-[var(--studio-muted)]">{formatValue(slice.value)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
