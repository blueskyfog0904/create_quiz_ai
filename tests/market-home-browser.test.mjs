import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('english and korean share one subject-aware preview composition', async () => {
  const [page, header, slider] = await Promise.all([
    read('src/app/preview/solvook-concept/page.tsx'),
    read('src/app/preview/solvook-concept/_components/preview-header.tsx'),
    read('src/app/preview/solvook-concept/_components/home/popular-downloads-slider.tsx'),
  ])

  assert.match(page, /value === 'korean' \? 'korean' : 'english'/)
  assert.match(page, /getMarketHomeData\(subject\)/)
  assert.match(page, /getPublicMainAdCarouselItems\(subject\)/)
  assert.equal((page.match(/<MainAdCarousel\b/g) ?? []).length, 1)
  assert.match(page, /<MainAdCarousel[\s\S]*subject=\{subject\}[\s\S]*items=\{mainAdItems\}/)
  assert.doesNotMatch(page, /CampaignHero/)
  assert.doesNotMatch(page, /mainAdItems\.length\s*>\s*0/)

  const sectionOrder = [
    '<PopularDownloadsSlider',
    '<RecentMaterials',
    '<TextbookExplorer',
    '<HomeFinalCta',
  ].map((section) => page.indexOf(section))
  assert.ok(sectionOrder.every((index) => index >= 0))
  assert.deepEqual(sectionOrder, [...sectionOrder].sort((a, b) => a - b))

  assert.match(header, /\?subject=english/)
  assert.match(header, /\?subject=korean/)
  assert.match(header, /aria-current=\{subject === 'english'/)
  assert.match(header, /aria-current=\{subject === 'korean'/)
  assert.match(header, /const marketHref = `\/\$\{subject\}\/market\/entexam`/)

  for (const viewport of [320, 390, 768, 1200, 1280]) {
    assert.match(slider, new RegExp(`viewport ${viewport}`))
  }
})

for (const subject of ['english', 'korean']) {
  test(`live ${subject} preview keeps subject links and section order`, {
    skip: !process.env.MARKET_HOME_BASE_URL,
  }, async () => {
    const response = await fetch(
      `${process.env.MARKET_HOME_BASE_URL}/preview/solvook-concept?subject=${subject}`
    )
    assert.equal(response.status, 200)
    const html = await response.text()
    const subjectLabel = subject === 'korean' ? '국어' : '영어'

    assert.match(html, new RegExp(`action="/${subject}/market/entexam"`))
    assert.match(html, new RegExp(`>${subjectLabel}<`))
    assert.match(html, new RegExp(`href="/preview/solvook-concept\\?subject=${subject}"`))

    const headingOrder = [
      '인기 다운로드 자료',
      '최근 등록된 수업 자료',
      '교재와 출처로 골라보기',
    ].map((heading) => html.indexOf(heading))
    assert.ok(headingOrder.every((index) => index >= 0))
    assert.deepEqual(headingOrder, [...headingOrder].sort((a, b) => a - b))
    assert.doesNotMatch(html, new RegExp(`href="/${subject === 'korean' ? 'english' : 'korean'}/market/`))
  })
}
