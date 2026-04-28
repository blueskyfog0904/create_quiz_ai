export default function MarketListboardLoading() {
  return (
    <div className="space-y-6">
      <div className="animate-pulse rounded-2xl border bg-slate-900 p-6">
        <div className="h-4 w-28 rounded bg-white/20" />
        <div className="mt-4 h-8 w-48 rounded bg-white/20" />
        <div className="mt-3 h-4 w-full max-w-xl rounded bg-white/15" />
      </div>
      <div className="animate-pulse rounded-2xl border bg-white p-6">
        <div className="h-5 w-24 rounded bg-slate-200" />
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <div className="h-3 w-12 rounded bg-slate-200" />
              <div className="h-10 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      </div>
      <div className="animate-pulse rounded-2xl border bg-white p-6">
        <div className="h-5 w-24 rounded bg-slate-200" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-20 rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
    </div>
  )
}
