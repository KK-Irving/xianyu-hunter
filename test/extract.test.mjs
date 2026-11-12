import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractItemId, extractUserId, parsePrice, safeParseJSON } from '../lib/utils.mjs';
import * as C from '../lib/constants.mjs';

test('extractItemId: 从 href 提取商品 id', () => {
  assert.equal(extractItemId('https://www.goofish.com/item?id=823456789'), '823456789');
  assert.equal(extractItemId('/item?spm=a.b&id=12345'), '12345');
  assert.equal(extractItemId('https://x.com/item?foo=1'), null);
});

test('parsePrice: 边界与小数', () => {
  assert.equal(parsePrice('¥1234.56'), 1234.56);
  assert.equal(parsePrice('1,234,567'), 1234567);
  assert.equal(parsePrice('价格待议'), null);
  assert.equal(parsePrice(null), null);
  assert.equal(parsePrice(undefined), null);
});

test('safeParseJSON: 嵌套结构', () => {
  const input = '前缀 {"a":{"b":[1,2,{"c":3}]},"d":"x"} 后缀';
  assert.deepEqual(safeParseJSON(input), { a: { b: [1, 2, { c: 3 }] }, d: 'x' });
});

test('safeParseJSON: 嵌套数组内含对象', () => {
  const input = '```json\n[{"pass":true},{"pass":false,"reason":"贵"}]\n```';
  assert.deepEqual(safeParseJSON(input), [{ pass: true }, { pass: false, reason: '贵' }]);
});

test('safeParseJSON: 数组中字符串含方括号', () => {
  const input = '["你好[在]吗", "成色[9新]"]';
  assert.deepEqual(safeParseJSON(input), ['你好[在]吗', '成色[9新]']);
});

test('safeParseJSON: 非对象/数组的裸标量走整体解析', () => {
  // 整体 JSON.parse 对裸数字/布尔有效
  assert.equal(safeParseJSON('42'), 42);
  assert.equal(safeParseJSON('true'), true);
});

test('constants: 关键常量取值合理', () => {
  assert.equal(C.MAX_CHAT_MSG_LEN, 20);
  assert.equal(C.COARSE_BATCH_SIZE, 15);
  assert.equal(C.WS_MAX_RECONNECTS, 10);
  assert.ok(C.WS_SWEEP_INTERVAL_MS > 0);
  assert.ok(Array.isArray(C.CHAT_MSG_DELAY) && C.CHAT_MSG_DELAY.length === 2);
  assert.ok(C.CHAT_MSG_DELAY[0] <= C.CHAT_MSG_DELAY[1]);
  assert.ok(C.FINE_ITEM_DELAY[0] <= C.FINE_ITEM_DELAY[1]);
  assert.ok(C.PERSIST_THROTTLE_MS > 0 && C.PERSIST_INTERVAL_MS > C.PERSIST_THROTTLE_MS);
});