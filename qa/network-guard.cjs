'use strict'
// Loaded only by isolated QA. Test doubles may replace fetch explicitly.
const blocked = () => { throw Error('QA outbound network disabled: use an explicit test double') }
globalThis.fetch = async () => blocked()
for (const name of ['node:http', 'node:https']) {
  const api = require(name)
  api.request = blocked
  api.get = blocked
}
