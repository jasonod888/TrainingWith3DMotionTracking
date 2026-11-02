import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRECT_ONLY_COPY,RTC_DEFAULTS,connectionFailureCopy,hasRelay,iceConfiguration,parseIceServers,retryDelay,
} from '../src/rtc-config.ts';

test('this milestone configures no relay and says so honestly', () => {
  const configuration = iceConfiguration();
  assert.deepEqual(configuration.iceServers, []);
  assert.equal(hasRelay(configuration), false);
  assert.equal(connectionFailureCopy(configuration), DIRECT_ONLY_COPY);
  assert.match(DIRECT_ONLY_COPY, /same router|different network|block/);
  // The copy must not promise that a local network will always work.
  assert.doesNotMatch(DIRECT_ONLY_COPY, /should work|will work|always/);
});

test('a relay can be added later without changing call sites', () => {
  const configuration = iceConfiguration([{urls: 'turns:relay.example.test:5349', username: 'short-lived', credential: 'token'}]);
  assert.equal(hasRelay(configuration), true);
  assert.match(connectionFailureCopy(configuration), /retry/);
  assert.doesNotMatch(connectionFailureCopy(configuration), /lan|same-wi-fi/i);
});

test('ICE server parsing is defensive', () => {
  assert.deepEqual(parseIceServers(null), []);
  assert.deepEqual(parseIceServers(''), []);
  assert.deepEqual(parseIceServers('{not json'), []);
  assert.deepEqual(parseIceServers('{"urls":"stun:x"}'), []);
  assert.deepEqual(parseIceServers('[null,3,{"nope":true}]'), []);
  assert.deepEqual(parseIceServers('[{"urls":["stun:a","stun:b"]},{"urls":"turn:c","username":"u","credential":"p"}]'), [
    {urls: ['stun:a', 'stun:b']},
    {urls: 'turn:c', username: 'u', credential: 'p'},
  ]);
  // Empty credentials are dropped rather than sent as blank strings.
  assert.deepEqual(parseIceServers('[{"urls":"turn:c","username":"","credential":""}]'), [{urls: 'turn:c'}]);
});

test('retry backoff is bounded', () => {
  assert.equal(retryDelay(-3), RTC_DEFAULTS.retryDelaysMs[0]);
  assert.equal(retryDelay(0), RTC_DEFAULTS.retryDelaysMs[0]);
  assert.equal(retryDelay(99), RTC_DEFAULTS.retryDelaysMs[RTC_DEFAULTS.retryDelaysMs.length - 1]);
  for (let attempt = 0; attempt < 6; attempt += 1) assert.ok(retryDelay(attempt) > 0);
});
