import Image from 'next/image'

// 섹션 제목 줄 오른쪽 뒤에 깔리는 꾸밈 그림(낙서풍 선 그림, public/home-decor). 섹션 순서대로 번갈아 쓴다.
// 꾸밈일 뿐이라 읽어 주지 않고, 좁은 화면에서는 제목과 겹치므로 그리지 않는다.
const SECTION_DOODLES = [
  { src: '/home-decor/section-doodle-a.webp', width: 960, height: 204 },
  { src: '/home-decor/section-doodle-b.webp', width: 960, height: 239 },
] as const

export function SectionDoodle({ index }: { index: number }) {
  const doodle = SECTION_DOODLES[index % SECTION_DOODLES.length]
  // 제목 줄(높이 2rem) 아랫선에 그림 아랫선을 맞춘다. 키는 섹션 사이 간격 + 제목 줄보다 작게 고정해 위 섹션 목록에 닿지 않는다.
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 hidden h-8 select-none md:block">
      <Image
        src={doodle.src}
        alt=""
        width={doodle.width}
        height={doodle.height}
        className="absolute bottom-0 right-0 h-[84px] w-auto max-w-none opacity-70"
      />
    </div>
  )
}
