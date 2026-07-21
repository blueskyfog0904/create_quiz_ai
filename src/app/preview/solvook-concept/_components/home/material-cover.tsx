import type {
  SampleCover,
  SampleCoverTheme,
} from '../../_data/sample-data'

const coverThemes: Record<
  SampleCoverTheme,
  {
    background: string
    accent: string
    page: string
  }
> = {
  violet: {
    background: 'from-[#382582] via-[#5741bb] to-[#826bf2]',
    accent: 'bg-[#9af0d6]',
    page: 'bg-[#f2efff]',
  },
  mint: {
    background: 'from-[#155e63] via-[#278c88] to-[#63cdb7]',
    accent: 'bg-[#ffd789]',
    page: 'bg-[#e9fffa]',
  },
  coral: {
    background: 'from-[#8f342e] via-[#cf5549] to-[#f38a6c]',
    accent: 'bg-[#ffe38c]',
    page: 'bg-[#fff0ec]',
  },
  navy: {
    background: 'from-[#172541] via-[#273c65] to-[#476490]',
    accent: 'bg-[#b3d8ff]',
    page: 'bg-[#edf4ff]',
  },
}

interface MaterialCoverProps {
  cover: SampleCover
  compact?: boolean
}

export function MaterialCover({
  cover,
  compact = false,
}: MaterialCoverProps) {
  const theme = coverThemes[cover.theme]

  return (
    <div
      aria-hidden="true"
      className={`relative isolate overflow-hidden rounded-md bg-gradient-to-br ${theme.background} ${
        compact ? 'aspect-[4/3]' : 'aspect-[4/5]'
      }`}
    >
      <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full border-[18px] border-white/10" />
      <div className="absolute -bottom-8 -left-8 h-28 w-28 rotate-12 rounded-[26px] border-[16px] border-white/10" />
      <div className="relative flex h-full flex-col p-5 text-white">
        <span className="text-[9px] font-extrabold tracking-[0.16em] text-white/75">
          {cover.eyebrow}
        </span>
        <div className={`mt-auto ${compact ? 'max-w-[75%]' : ''}`}>
          <span className={`mb-3 block h-1 w-10 rounded-full ${theme.accent}`} />
          <strong className="block break-keep text-xl font-extrabold leading-tight tracking-[-0.035em]">
            {cover.title}
          </strong>
          <span className="mt-2 block text-[11px] font-semibold leading-4 text-white/75">
            {cover.subtitle}
          </span>
        </div>
        <div
          className={`absolute bottom-5 right-5 grid h-12 w-9 place-items-center rounded-[3px] shadow-md ${theme.page}`}
        >
          <span className="h-px w-5 bg-black/20" />
          <span className="h-px w-5 bg-black/20" />
          <span className="h-px w-3 bg-black/20" />
        </div>
      </div>
    </div>
  )
}
