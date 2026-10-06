// 파일 형식 연상색 문서 아이콘 (외부 로고 이미지 대신 자체 SVG — HWP=파랑, PDF=빨강, ZIP=회색)
const FILE_TYPE_ICON_COLORS: Record<string, string> = {
  hwp: '#2D6EEF',
  pdf: '#E5252A',
  zip: '#6B7280',
}

// className으로 크기만 바꿀 수 있다(기본은 버튼 안 작은 크기).
export function FileTypeDocIcon({ code, className = 'h-[18px] w-4' }: { code: string; className?: string }) {
  const normalized = code.toLowerCase()
  const color = FILE_TYPE_ICON_COLORS[normalized] ?? '#6B7280'
  return (
    <svg viewBox="0 0 16 18" className={`${className} shrink-0`} aria-hidden="true">
      <path
        d="M3.5 1h6L14 5.5V15.5A1.5 1.5 0 0 1 12.5 17h-9A1.5 1.5 0 0 1 2 15.5v-13A1.5 1.5 0 0 1 3.5 1z"
        fill={color}
      />
      <path d="M9.5 1 14 5.5h-3.5a1 1 0 0 1-1-1z" fill="#ffffff" fillOpacity="0.45" />
      <text
        x="8"
        y="13.5"
        textAnchor="middle"
        fontSize="4.6"
        fontWeight="800"
        fill="#ffffff"
      >
        {normalized.toUpperCase()}
      </text>
    </svg>
  )
}
