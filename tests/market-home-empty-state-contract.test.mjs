import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('real-data home sections retain their original shells when empty', async () => {
  const [page, carousel, slider, sections] = await Promise.all([
    read('src/app/preview/solvook-concept/page.tsx'),
    read('src/app/preview/solvook-concept/_components/home/main-ad-carousel.tsx'),
    read('src/app/preview/solvook-concept/_components/home/popular-downloads-slider.tsx'),
    read('src/app/preview/solvook-concept/_components/home/home-material-sections.tsx'),
  ])

  assert.doesNotMatch(page, /CampaignHero/)
  assert.match(carousel, /data-state=\{carouselState\}/)
  assert.match(carousel, /role="status"/)
  assert.match(carousel, /등록된 \{subjectLabel\} 광고가 없습니다/)
  assert.doesNotMatch(carousel, /if\s*\(!activeItem\)\s*\{\s*return null\s*\}/)
  assert.match(slider, /아직 다운로드 집계가 없습니다/)
  assert.match(sections, /출처별 자료를 준비하고 있습니다/)
  assert.match(sections, /최근 등록된 자료가 없습니다/)
})
