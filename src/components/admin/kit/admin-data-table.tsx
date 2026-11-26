import * as React from 'react'

import { cn } from '@/lib/utils'

import { ADMIN_TABLE_PAGE_WIDTH_LIMIT, adminTableBodyCellClass, adminTableHeadCellClass } from './admin-data-table-classes'

export { ADMIN_TABLE_PAGE_WIDTH_LIMIT }

export interface AdminDataTableColumn<Row> {
  key: string
  // 머리 글. 정렬 버튼이 필요하면 화면이 지금 방식대로 버튼을 넣는다(부품은 정렬하지 않음).
  header: React.ReactNode
  cell: (row: Row, index: number) => React.ReactNode
  // 숫자 열: 오른쪽 정렬·tabular-nums
  numeric?: boolean
  align?: 'left' | 'center' | 'right'
  // 개인정보 칸(이메일·전화·메모·문의 본문 등). 화면 비교 스크립트가 data-admin-pii 칸을 가린다.
  pii?: boolean
  // 정렬 상태(aria-sort)
  sort?: 'ascending' | 'descending' | 'none'
  className?: string
  headerClassName?: string
}

interface AdminDataTableProps<Row> {
  columns: AdminDataTableColumn<Row>[]
  rows: Row[]
  getRowKey: (row: Row, index: number) => React.Key
  // 화면 읽기용 표 이름(보이지 않음)
  caption: string
  // 표 최소 폭(px). 960 이하로 정한다. 넘으면 xl 이상에서도 표 안 가로 스크롤(머리 고정 없음).
  minWidth?: number
  // 조밀(행 32px). 기본 40px.
  dense?: boolean
  // 불러오는 중·비어 있음·실패(AdminTableState)를 행 대신 보인다.
  state?: React.ReactNode
  className?: string
}

// 관리자 표(20번 5-2). 넓이 규칙:
// - xl(1280px) 이상: 페이지 스크롤 + 머리 고정(가로 넘침 틀 없음).
// - xl 미만: 표 영역 안에서만 가로 스크롤, 머리 고정 없음, 첫 열 고정.
// 행 누르기는 첫 열 안의 링크·버튼으로 한다(tr onClick 없음, 5-4).
export function AdminDataTable<Row>({
  columns,
  rows,
  getRowKey,
  caption,
  minWidth,
  dense = false,
  state,
  className,
}: AdminDataTableProps<Row>) {
  const wide = (minWidth ?? 0) > ADMIN_TABLE_PAGE_WIDTH_LIMIT
  const alignOf = (column: AdminDataTableColumn<Row>) => column.align ?? (column.numeric ? 'right' : 'left')

  return (
    <div
      data-slot="admin-data-table"
      className={cn(
        'w-full overflow-x-auto rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]',
        !wide && 'xl:overflow-visible',
        className
      )}
    >
      <table className="w-full border-collapse text-[13px] text-[var(--studio-text)]" style={minWidth ? { minWidth } : undefined}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[var(--studio-border)]">
            {columns.map((column, columnIndex) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={column.sort}
                className={adminTableHeadCellClass({
                  first: columnIndex === 0,
                  wide,
                  dense,
                  align: alignOf(column),
                  className: column.headerClassName,
                })}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state ? (
            <tr>
              <td colSpan={columns.length} className="p-4">
                {state}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={getRowKey(row, rowIndex)} className="border-b border-[var(--studio-border)] last:border-b-0 hover:bg-[var(--studio-background)]">
                {columns.map((column, columnIndex) => (
                  <td
                    key={column.key}
                    data-admin-pii={column.pii ? '' : undefined}
                    className={adminTableBodyCellClass({
                      first: columnIndex === 0,
                      wide,
                      dense,
                      align: alignOf(column),
                      numeric: column.numeric,
                      className: column.className,
                    })}
                  >
                    {column.cell(row, rowIndex)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
