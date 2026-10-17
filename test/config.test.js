import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseServerUrl } from '../src/config.js';

test('addresses: bare host, port, copied URL; never credentials', () => {
  assert.equal(parseServerUrl('192.0.2.10:51821'), 'http://192.0.2.10:51821');
  assert.equal(parseServerUrl(' https://vpn.example.com/clients '), 'https://vpn.example.com');
  assert.equal(parseServerUrl('http://admin:pw@192.0.2.10'), null);
  assert.equal(parseServerUrl('ftp://192.0.2.10'), null);
  assert.equal(parseServerUrl(''), null);
});

test('defaults and normalization', () => {
  const config = normalizeConfig(DEFAULT_CONFIG);
  assert.equal(config.url, null);
  assert.equal(config.invalidUrl, false);
  assert.equal(config.username, 'admin');
  assert.equal(config.pollIntervalMs, 30_000);
  assert.equal(config.allowControl, false);
  assert.equal(config.language, 'fr');
  const custom = normalizeConfig({
    url: 'nope://',
    username: '  ',
    password: ' spaced ',
    poll_interval: 15,
    allow_control: 'true',
    language: 'it',
  });
  assert.equal(custom.invalidUrl, true);
  assert.equal(custom.username, 'admin');
  assert.equal(custom.password, ' spaced ');
  assert.equal(custom.pollIntervalMs, 15_000);
  assert.equal(custom.allowControl, true);
  assert.equal(custom.language, 'fr');
  assert.equal(normalizeConfig({ poll_interval: '7' }).pollIntervalMs, 30_000);
});
