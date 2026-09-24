import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthManager, SESSION_TTL_MS } from './auth.ts'

test('successful login creates an expiring session without exposing the password', () => {
  const auth = new AuthManager('test-password')
  const result = auth.login('test-password', 'client-a', 1_000)

  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') return
  assert.equal(typeof result.sessionId, 'string')
  assert.notEqual(result.sessionId, 'test-password')
  assert.equal(auth.isAuthenticated(`other=x; stock_session=${result.sessionId}`, 1_000), true)
  assert.equal(auth.isAuthenticated(`stock_session=${result.sessionId}`, 1_000 + SESSION_TTL_MS), false)
})

test('logout revokes the matching session', () => {
  const auth = new AuthManager('test-password')
  const result = auth.login('test-password', 'client-a', 1_000)
  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') return

  const cookie = `stock_session=${result.sessionId}`
  auth.logout(cookie)
  assert.equal(auth.isAuthenticated(cookie, 1_001), false)
})

test('login attempts are limited by client and unlock after the cooldown', () => {
  const auth = new AuthManager('test-password')
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal(auth.login('wrong', 'client-a', 1_000 + attempt).status, 'invalid')
  }
  assert.equal(auth.login('wrong', 'client-a', 1_004).status, 'limited')
  assert.equal(auth.login('test-password', 'client-a', 1_005).status, 'limited')
  assert.equal(auth.login('test-password', 'client-b', 1_005).status, 'ok')
  assert.equal(auth.login('test-password', 'client-a', 1_000 + 15 * 60 * 1000 + 1_000).status, 'ok')
})

test('missing password configuration fails closed', () => {
  assert.equal(new AuthManager(undefined).login('anything', 'client-a').status, 'unconfigured')
})
