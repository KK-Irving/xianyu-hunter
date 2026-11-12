import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeParseJSON, parsePrice, extractUserId } from '../lib/utils.mjs';

/**
 * 复刻 TaskManager._applyPriceGuard 的纯逻辑用于测试
 * （原方法在依赖 playwright 的类上，此处隔离验证算法本身）。
 */
function applyPriceGuard(products, config) {
  const { priceMin, priceMax } = config;
  if (priceMin == null && priceMax == null) return products;
  const UPPER_MARGIN = 1.5;
  const kept = [];
  for (const p of products) {
    const price = parsePrice(p.detailPrice) ?? parsePrice(p.price);
    if (price == null) { kept.push(p); continue; }
    if (priceMin != null && price < priceMin) continue;
    if (priceMax != null && price > priceMax * UPPER_MARGIN) continue;
    kept.push(p);
  }
  return kept;
}

test('safeParseJSON: 纯 JSON 数组', () => {
  assert.deepEqual(safeParseJSON('[0,1,2,3]'), [0, 1, 2, 3]);
});

test('safeParseJSON: 纯 JSON 对象', () => {
  assert.deepEqual(safeParseJSON('{"pass":true,"reason":"ok"}'), { pass: true, reason: 'ok' });
});

test('safeParseJSON: 带 ```json 代码围栏', () => {
  const input = '```json\n{"reached":false,"reason":"继续"}\n```';
  assert.deepEqual(safeParseJSON(input), { reached: false, reason: '继续' });
});

test('safeParseJSON: 无语言标注的代码围栏', () => {
  const input = '```\n[1, 2, 3]\n```';
  assert.deepEqual(safeParseJSON(input), [1, 2, 3]);
});

test('safeParseJSON: JSON 前后夹带解释文字', () => {
  const input = '好的，判断结果如下：{"pass":false,"reason":"电池80%"} 以上。';
  assert.deepEqual(safeParseJSON(input), { pass: false, reason: '电池80%' });
});

test('safeParseJSON: 数组前有文字', () => {
  const input = '保留的序号是 [0, 2, 5]';
  assert.deepEqual(safeParseJSON(input), [0, 2, 5]);
});

test('safeParseJSON: 字符串内含括号不影响平衡提取', () => {
  const input = '{"reason":"价格[偏高]但可接受{含运费}","pass":true}';
  assert.deepEqual(safeParseJSON(input), { reason: '价格[偏高]但可接受{含运费}', pass: true });
});

test('safeParseJSON: 字符串内含转义引号', () => {
  const input = '{"text":"他说\\"在的\\"呢","ok":true}';
  assert.deepEqual(safeParseJSON(input), { text: '他说"在的"呢', ok: true });
});

test('safeParseJSON: 聊天消息数组', () => {
  const input = '["你好呀~", "还在吗", "成色怎么样"]';
  assert.deepEqual(safeParseJSON(input), ['你好呀~', '还在吗', '成色怎么样']);
});

test('safeParseJSON: 完全无法解析返回 fallback', () => {
  assert.equal(safeParseJSON('这是一段没有任何JSON的文字', null), null);
  assert.deepEqual(safeParseJSON('纯文本', []), []);
});

test('safeParseJSON: 空与 null 输入返回 fallback', () => {
  assert.equal(safeParseJSON('', 'fb'), 'fb');
  assert.equal(safeParseJSON(null, 'fb'), 'fb');
  assert.equal(safeParseJSON('   ', 'fb'), 'fb');
});

test('safeParseJSON: 提取第一个 JSON 块', () => {
  const input = '第一个{"a":1}然后{"b":2}';
  assert.deepEqual(safeParseJSON(input), { a: 1 });
});

// 顺带覆盖既有纯函数，防回归
test('parsePrice: 常见价格文本', () => {
  assert.equal(parsePrice('¥3,999'), 3999);
  assert.equal(parsePrice('3999元'), 3999);
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice('面议'), null);
});

test('extractUserId: 从 URL 提取 userId/peerUserId', () => {
  assert.equal(extractUserId('https://x.com/im?peerUserId=123&itemId=9'), '123');
  assert.equal(extractUserId('https://x.com/p?userId=456'), '456');
  assert.equal(extractUserId('https://x.com/p?foo=bar'), null);
});

test('价格兜底: 剔除低于下限的商品', () => {
  const products = [
    { title: '手机壳', price: '¥29' },
    { title: 'MacBook', price: '¥3999' },
  ];
  const kept = applyPriceGuard(products, { priceMin: 1000, priceMax: 5000 });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].title, 'MacBook');
});

test('价格兜底: 剔除超上限 1.5 倍的商品', () => {
  const products = [
    { title: '正常', price: '¥4500' },   // 在 5000*1.5 内，保留
    { title: '超贵', price: '¥8000' },   // > 7500，剔除
  ];
  const kept = applyPriceGuard(products, { priceMin: null, priceMax: 5000 });
  assert.deepEqual(kept.map(p => p.title), ['正常']);
});

test('价格兜底: 偏高但在容忍范围内保留(可砍价)', () => {
  const products = [{ title: '略超', price: '¥5500' }]; // < 7500
  const kept = applyPriceGuard(products, { priceMin: null, priceMax: 5000 });
  assert.equal(kept.length, 1);
});

test('价格兜底: 无法解析价格的商品保留', () => {
  const products = [{ title: '面议', price: '面议' }];
  const kept = applyPriceGuard(products, { priceMin: 1000, priceMax: 5000 });
  assert.equal(kept.length, 1);
});

test('价格兜底: 优先使用 detailPrice', () => {
  const products = [{ title: 'x', price: '¥99', detailPrice: '¥3999' }];
  const kept = applyPriceGuard(products, { priceMin: 1000, priceMax: 5000 });
  assert.equal(kept.length, 1); // detailPrice 3999 在范围内，不因列表价 99 被误删
});

test('价格兜底: 无价格条件时原样返回', () => {
  const products = [{ title: 'a', price: '¥1' }, { title: 'b', price: '¥999999' }];
  const kept = applyPriceGuard(products, { priceMin: null, priceMax: null });
  assert.equal(kept.length, 2);
});

/**
 * 指纹一致性回归：模拟 _nextFingerprint 的计数逻辑，
 * 验证 WS 路径与 DOM 路径对重复消息产生相同的 "#序号" 指纹。
 */
test('指纹方案: 重复消息生成递增序号，与 DOM 口径一致', () => {
  const msgFingerprint = (role, content) => `${role}:${content.trim()}`;
  const nextFingerprint = (messages, role, content) => {
    const base = msgFingerprint(role, content);
    let count = 0;
    for (const m of messages) {
      if (m.role === role && m.content === content) count++;
    }
    return count === 0 ? base : `${base}#${count + 1}`;
  };

  const messages = [];
  // 卖家连续发两次"在的"
  const fp1 = nextFingerprint(messages, 'other', '在的');
  messages.push({ role: 'other', content: '在的', fingerprint: fp1 });
  const fp2 = nextFingerprint(messages, 'other', '在的');
  messages.push({ role: 'other', content: '在的', fingerprint: fp2 });

  assert.equal(fp1, 'other:在的');
  assert.equal(fp2, 'other:在的#2');
  assert.notEqual(fp1, fp2); // 关键：第二条不会被误判为重复

  // 模拟 DOM extractMessages 对同一快照的计数（应得到相同指纹集）
  const domCounters = {};
  const domFps = ['在的', '在的'].map(content => {
    const base = `other:${content}`;
    domCounters[base] = (domCounters[base] || 0) + 1;
    return domCounters[base] > 1 ? `${base}#${domCounters[base]}` : base;
  });
  assert.deepEqual(domFps, [fp1, fp2]); // WS 与 DOM 指纹完全一致
});