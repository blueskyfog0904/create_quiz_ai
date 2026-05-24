import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import '../src/components/features/passages/node-test-register.mjs'


const { extractHwpxTextFromBuffer, validateHwpxUploadFile } = await import('../src/lib/question-bank/hwpx-extractor.ts')

async function createHwpx(entries) {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content)
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

test('extractHwpxTextFromBuffer reads whitelisted section XML text in order', async () => {
  const buffer = await createHwpx({
    'Contents/section0.xml': '<hp:p><hp:run><hp:t>1. 다음 글의 제목으로 알맞은 것은?</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>① Technology</hp:t></hp:run></hp:p>',
    'Contents/section1.xml': '<hp:p><hp:run><hp:t>정답 1</hp:t></hp:run></hp:p>',
    'BinData/image1.png': 'ignored',
  })

  const result = await extractHwpxTextFromBuffer(buffer)

  assert.equal(result.sections.length, 2)
  assert.match(result.text, /1\. 다음 글의 제목/)
  assert.match(result.text, /① Technology/)
  assert.match(result.text, /정답 1/)
})

test('validateHwpxUploadFile rejects non-hwpx oversized and non-zip files', () => {
  assert.deepEqual(validateHwpxUploadFile('exam.pdf', Buffer.from('PK')), {
    ok: false,
    reason: 'HWPX 파일만 업로드할 수 있습니다.',
  })

  assert.deepEqual(validateHwpxUploadFile('exam.hwpx', Buffer.alloc(10 * 1024 * 1024 + 1)), {
    ok: false,
    reason: 'HWPX 파일은 10MB 이하만 업로드할 수 있습니다.',
  })

  assert.deepEqual(validateHwpxUploadFile('exam.hwpx', Buffer.from('not zip')), {
    ok: false,
    reason: '올바른 HWPX ZIP 파일이 아닙니다.',
  })
})

test('extractHwpxTextFromBuffer rejects too many entries missing section and unsafe paths', async () => {
  const manyEntries = {}
  for (let i = 0; i < 301; i++) {
    manyEntries[`Contents/section${i}.xml`] = '<hp:t>x</hp:t>'
  }

  await assert.rejects(
    () => createHwpx(manyEntries).then((buffer) => extractHwpxTextFromBuffer(buffer)),
    /HWPX 내부 파일 수가 너무 많습니다/
  )

  const empty = await createHwpx({ 'mimetype': 'application/hwp+zip' })
  await assert.rejects(() => extractHwpxTextFromBuffer(empty), /본문 XML을 찾을 수 없습니다/)

  const unsafe = await createHwpx({ 'Contents/../section0.xml': '<hp:t>x</hp:t>' })
  await assert.rejects(() => extractHwpxTextFromBuffer(unsafe), /허용되지 않는 HWPX 내부 경로/)
})

test('extractHwpxTextFromBuffer rejects oversized uncompressed XML before reading content', async () => {
  const hugeXml = `<hp:p><hp:run><hp:t>${'x'.repeat(1024 * 1024 + 1)}</hp:t></hp:run></hp:p>`
  const buffer = await createHwpx({ 'Contents/section0.xml': hugeXml })

  await assert.rejects(
    () => extractHwpxTextFromBuffer(buffer),
    /HWPX XML 항목 크기가 너무 큽니다/
  )
})
