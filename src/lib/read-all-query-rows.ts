// PostgREST 응답 상한에 걸려 집계/필터 결과가 조용히 누락되지 않도록 분할 조회한다.
// 호출부는 반드시 고유 키까지 포함한 고정 정렬을 지정한다.
export async function readAllQueryRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = []
  const batchSize = 500
  for (let from = 0; ; from += batchSize) {
    const { data, error } = await query(from, from + batchSize - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if ((data?.length ?? 0) < batchSize) return rows
  }
}
