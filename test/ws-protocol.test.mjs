import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWsMessage, extractChatItems, decodeWsFrameItem } from '../lib/ws-protocol.mjs';
import { msgFingerprint, extractUrlParam } from '../lib/dom-extract.mjs';

test('extractChatItems: 仅返回 /s/sync 帧的 bizType=40 项', () => {
  const frame = {
    lwp: '/s/sync',
    body: { syncPushPackage: { data: [
      { bizType: 40, data: 'a' },
      { bizType: 99, data: 'b' },
      { bizType: 40, data: 'c' },
    ] } },
  };
  const items = extractChatItems(frame);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(i => i.data), ['a', 'c']);
});

test('extractChatItems: 非 /s/sync 或结构缺失返回空数组', () => {
  assert.deepEqual(extractChatItems({ lwp: '/other' }), []);
  assert.deepEqual(extractChatItems({ lwp: '/s/sync', body: {} }), []);
  assert.deepEqual(extractChatItems(null), []);
  assert.deepEqual(extractChatItems({ lwp: '/s/sync', body: { syncPushPackage: { data: 'x' } } }), []);
});

test('parseWsMessage: 提取 senderUserId/text/itemId/peerUserId', () => {
  // 构造一段贴近真实协议的二进制可读串
  const decoded =
    'senderUserId\x00123456\x01' +
    'reminderTitle\x00小明\x01' +
    '{"atUsers":[],"text":{"text":"你好呀"}}' +
    'reminderUrl?itemId=888&peerUserId=123456';
  const msg = parseWsMessage(decoded);
  assert.equal(msg.senderUserId, '123456');
  assert.equal(msg.text, '你好呀');
  assert.equal(msg.senderName, '小明');
  assert.equal(msg.itemId, '888');
  assert.equal(msg.peerUserId, '123456');
});

test('parseWsMessage: 缺少 text 或 senderUserId 返回 null', () => {
  assert.equal(parseWsMessage('reminderTitle\x00x\x01'), null);
  assert.equal(parseWsMessage(''), null);
  assert.equal(parseWsMessage(null), null);
});

test('parseWsMessage: 文本含转义引号', () => {
  const decoded =
    'senderUserId\x00999\x01' +
    '{"atUsers":[],"text":{"text":"他说\\"好\\""}}';
  const msg = parseWsMessage(decoded);
  assert.equal(msg.senderUserId, '999');
  assert.equal(msg.text, '他说\\"好\\"');
});

test('decodeWsFrameItem: base64 往返解码 UTF-8', () => {
  // "你好" 的 UTF-8 base64
  const b64 = Buffer.from('你好', 'utf-8').toString('base64');
  assert.equal(decodeWsFrameItem(b64), '你好');
});

test('extractUrlParam: 标准与退化解析', () => {
  assert.equal(extractUrlParam('https://x.com/im?peerUserId=55&itemId=7', 'peerUserId'), '55');
  assert.equal(extractUrlParam('https://x.com/im?peerUserId=55&itemId=7', 'itemId'), '7');
  assert.equal(extractUrlParam('not a url ?itemId=42&x=1', 'itemId'), '42');
  assert.equal(extractUrlParam('https://x.com/im', 'itemId'), '');
});

test('msgFingerprint: role:trimmed-content', () => {
  assert.equal(msgFingerprint('self', '  你好 '), 'self:你好');
  assert.equal(msgFingerprint('other', '在的'), 'other:在的');
});