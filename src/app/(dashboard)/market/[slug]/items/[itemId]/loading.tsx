export default function MarketItemDetailLoading() {
  return (
    <div className="space-y-6">
      <div className="animate-pulse overflow-hidden rounded-2xl border bg-white">
        <div className="bg-slate-900 p-6">
          <div className="h-4 w-40 rounded bg-white/20" />
          <div className="mt-4 h-8 w-full max-w-xl rounded bg-white/20" />
          <div className="mt-3 h-4 w-full max-w-lg rounded bg-white/15" />
        </div>
        <div className="space-y-6 p-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-20 rounded-2xl bg-slate-100" />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr),360px]">
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="h-56 rounded-2xl bg-slate-100" />
                <div className="h-56 rounded-2xl bg-slate-100" />
              </div>
              <div className="h-36 rounded-2xl bg-slate-100" />
            </div>
            <div className="space-y-3 rounded-2xl border p-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-28 rounded-2xl bg-slate-100" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
