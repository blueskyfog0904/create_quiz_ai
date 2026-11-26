import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

// 22번(계획 Q4·Q6·3-3, 의도적 변경):
// - 빈 섹션 문구는 코드 글이 아니라 DB(홈 진열 설정)의 emptyText 다. 없으면 섹션째 숨긴다.
//   시드가 지금 문구 두 개를 그대로 넣어 지금 모습(영어 홈 인기 0개 → "아직 다운로드 집계가 없습니다.")을 지킨다.
// - 보일 배너가 0개면 배너 영역을 숨긴다(빈 틀·"등록된 ○○ 광고가 없습니다" 없음).
// - 보일 섹션과 배너가 모두 0개면 빈 홈 링크 한 줄(DB 문구)을 보인다.
test('empty home sections use DB copy and an empty banner list hides the banner area', async () => {
  const [page, view, carousel, slider, sections, featured, homeSections] = await Promise.all([
    read('src/app/preview/solvook-concept/page.tsx'),
    read('src/app/(solvook)/_components/solvook-home-view.tsx'),
    read('src/app/preview/solvook-concept/_components/home/main-ad-carousel.tsx'),
    read('src/app/preview/solvook-concept/_components/home/popular-downloads-slider.tsx'),
    read('src/app/preview/solvook-concept/_components/home/home-material-sections.tsx'),
    read('src/app/preview/solvook-concept/_components/home/featured-materials.tsx'),
    read('src/app/preview/solvook-concept/_components/home/market-home-sections.tsx'),
  ])

  assert.doesNotMatch(page, /CampaignHero/)
  for (const source of [slider, sections, featured]) {
    assert.match(source, /\{emptyText\}/)
    assert.match(source, /<SectionHeading title=\{title\} \/>/)
    assert.doesNotMatch(source, /아직 다운로드 집계가 없습니다|최근 등록된 자료가 없습니다|인기 다운로드 자료|최근 등록된 수업 자료/)
  }
  assert.doesNotMatch(carousel, /광고가 없습니다/)
  assert.match(page, /hero=\{mainAdItems\.length > 0 \? <MainAdCarousel/)
  assert.match(view, /hero=\{adItems\.length > 0 \? <MainAdCarousel/)
  assert.match(homeSections, /visibleMarketHomeSections\(homeData\.sections\)/)
  assert.match(homeSections, /shouldShowEmptyHomeLink\(homeData, visibleBannerCount\)/)
  assert.match(homeSections, /\{homeData\.emptyHomeLink\}/)
})
