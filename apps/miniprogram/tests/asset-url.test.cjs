const test = require('node:test')
const assert = require('node:assert/strict')

const { resolveAssetUrls } = require('../dist/utils/asset-url.js')

test('converts uploaded image paths to absolute API URLs recursively', () => {
  const value = {
    images: ['/api/uploads/images/mold.png'],
    flowRecords: [{ images: ['/api/uploads/images/shipping.png'] }],
  }

  assert.deepEqual(resolveAssetUrls(value, 'http://190.160.9.29:3000/api'), {
    images: ['http://190.160.9.29:3000/api/uploads/images/mold.png'],
    flowRecords: [{ images: ['http://190.160.9.29:3000/api/uploads/images/shipping.png'] }],
  })
})

test('keeps remote URLs and non-image strings unchanged', () => {
  assert.deepEqual(
    resolveAssetUrls(
      ['https://cdn.example.com/mold.png', 'MD001', null],
      'http://190.160.9.29:3000/api',
    ),
    ['https://cdn.example.com/mold.png', 'MD001', null],
  )
})
