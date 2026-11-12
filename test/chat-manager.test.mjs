import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatManager } from '../lib/chat.mjs';

// ChatManager 导入会间接加载 browser.mjs → playwright（已安装），
// 但以下方法均只操作内存中的 this.sessions，不触发真实浏览器。
// 用无副作用的 emitLog / shouldStop 替身即可测试有状态逻辑。

function makeCM() {
  const logs = [];
  const cm = new ChatManager((m) => logs.push(m), () => false);
  return { cm, logs };
}

function makeProduct(over = {}) {
  return {
    id: over.id || 'p1',
    title: over.title || 'MacBook Air M2',
    price: over.price || '¥3999',
    description: over.description ?? '9成新 电池健康92%',
    sellerName: over.sellerName || '卖家小王',
    chatUrl: over.chatUrl ?? 'https://www.goofish.com/im?itemId=1&peerUserId=2',
    ...over,
  };
}

test('restoreSessions: 恢复 waiting 会话并重建 chatHistory', () => {
  const { cm } = makeCM();
  const saved = [{
    id: 'p1',
    product: makeProduct(),
    chatContext: { requirements: 'x', chatStrategy: 's' },
    status: 'waiting',
    messages: [
      { role: 'self', content: '你好呀~', time: 1 },
      { role: 'other', content: '在的', time: 2 },
    ],
    // 故意不给 chatHistory，验证会从 messages 重建
  }];

  const restored = cm.restoreSessions(saved, {});
  assert.equal(restored, 1);

  const session = cm.sessions.get('p1');
  assert.ok(session);
  assert.equal(session.status, 'waiting');
  assert.equal(session.messages.length, 2);
  // chatHistory 重建：self→assistant, other→user
  assert.deepEqual(session.chatHistory, [
    { role: 'assistant', content: '你好呀~' },
    { role: 'user', content: '在的' },
  ]);
  // 指纹集合已填充
  assert.ok(session.seenFingerprints.has('self:你好呀~'));
  assert.ok(session.seenFingerprints.has('other:在的'));
});

test('restoreSessions: 跳过 goal_reached / error / 无 chatUrl', () => {
  const { cm } = makeCM();
  const saved = [
    { id: 'a', product: makeProduct({ id: 'a' }), status: 'goal_reached', messages: [] },
    { id: 'b', product: makeProduct({ id: 'b' }), status: 'error', messages: [] },
    { id: 'c', product: makeProduct({ id: 'c', chatUrl: '' }), status: 'waiting', messages: [] },
    { id: 'd', product: makeProduct({ id: 'd' }), status: 'waiting', messages: [] },
  ];
  const restored = cm.restoreSessions(saved, {});
  assert.equal(restored, 1);
  assert.ok(cm.sessions.has('d'));
  assert.ok(!cm.sessions.has('a'));
  assert.ok(!cm.sessions.has('b'));
  assert.ok(!cm.sessions.has('c'));
});

test('restoreSessions: 保留已有 chatHistory，不覆盖', () => {
  const { cm } = makeCM();
  const existingHistory = [{ role: 'user', content: '自定义历史' }];
  const saved = [{
    id: 'p1',
    product: makeProduct(),
    status: 'waiting',
    messages: [{ role: 'other', content: '在的', time: 1 }],
    chatHistory: existingHistory,
  }];
  cm.restoreSessions(saved, {});
  assert.deepEqual(cm.sessions.get('p1').chatHistory, existingHistory);
});

test('restoreSessions: chatContext 回退到传入的默认值', () => {
  const { cm } = makeCM();
  const fallbackCtx = { requirements: 'fallback需求', chatStrategy: '' };
  const saved = [{
    id: 'p1',
    product: makeProduct(),
    status: 'waiting',
    messages: [],
    // 不带 chatContext
  }];
  cm.restoreSessions(saved, fallbackCtx);
  assert.equal(cm.sessions.get('p1').chatContext, fallbackCtx);
});

test('_nextFingerprint: 跨消息累计产生递增序号', () => {
  const { cm } = makeCM();
  const session = { messages: [] };
  const f1 = cm._nextFingerprint(session, 'other', '在的');
  session.messages.push({ role: 'other', content: '在的' });
  const f2 = cm._nextFingerprint(session, 'other', '在的');
  session.messages.push({ role: 'other', content: '在的' });
  const f3 = cm._nextFingerprint(session, 'other', '在的');
  assert.deepEqual([f1, f2, f3], ['other:在的', 'other:在的#2', 'other:在的#3']);
});

test('_nextFingerprint: 不同 role 独立计数', () => {
  const { cm } = makeCM();
  const session = { messages: [{ role: 'self', content: '好的' }] };
  // other 的"好的"是该 role 首次出现
  assert.equal(cm._nextFingerprint(session, 'other', '好的'), 'other:好的');
  // self 的"好的"已有一条
  assert.equal(cm._nextFingerprint(session, 'self', '好的'), 'self:好的#2');
});

test('_syncSnapshot: 基于指纹去重追加新消息', () => {
  const { cm } = makeCM();
  const session = {
    messages: [],
    chatHistory: [],
    seenFingerprints: new Set(),
  };
  const snap1 = [
    { role: 'self', content: 'A', fingerprint: 'self:A' },
    { role: 'other', content: 'B', fingerprint: 'other:B' },
  ];
  const added1 = cm._syncSnapshot(session, snap1);
  assert.equal(added1, 2);
  assert.equal(session.messages.length, 2);
  assert.deepEqual(session.chatHistory, [
    { role: 'assistant', content: 'A' },
    { role: 'user', content: 'B' },
  ]);

  // 第二次快照含一条重复 + 一条新消息
  const snap2 = [
    { role: 'other', content: 'B', fingerprint: 'other:B' }, // 重复
    { role: 'other', content: 'C', fingerprint: 'other:C' }, // 新
  ];
  const added2 = cm._syncSnapshot(session, snap2);
  assert.equal(added2, 1);
  assert.equal(session.messages.length, 3);
  assert.equal(session.chatHistory.at(-1).content, 'C');
});

test('_hasActiveSessions: 仅 waiting 视为活跃', () => {
  const { cm } = makeCM();
  assert.equal(cm._hasActiveSessions(), false);
  cm.sessions.set('a', { status: 'goal_reached' });
  assert.equal(cm._hasActiveSessions(), false);
  cm.sessions.set('b', { status: 'waiting' });
  assert.equal(cm._hasActiveSessions(), true);
});

test('getSessionsData: 序列化口径(截断描述/保留最近消息/promptSummary)', () => {
  const { cm } = makeCM();
  const longDesc = 'x'.repeat(300);
  cm.sessions.set('p1', {
    product: makeProduct({ description: longDesc }),
    chatContext: { chatStrategy: 's', requirements: 'r' },
    status: 'waiting',
    goalReason: '',
    messages: [
      { role: 'self', content: '1', time: 1 },
      { role: 'other', content: '2', time: 2 },
    ],
    lastChecked: 123,
  });
  const [d] = cm.getSessionsData();
  assert.equal(d.id, 'p1');
  assert.equal(d.productTitle, 'MacBook Air M2');
  assert.equal(d.messageCount, 2);
  assert.equal(d.productDescription.length, 200); // 截断到 200
  assert.deepEqual(d.promptSummary, {
    hasStrategy: true,
    hasProductContext: true,
    hasRequirements: true,
  });
  // messages 只含 role/content/time 三字段
  assert.deepEqual(Object.keys(d.messages[0]).sort(), ['content', 'role', 'time']);
});

test('getSessionsFullData: 保留完整 messages(含 fingerprint) 与 chatHistory', () => {
  const { cm } = makeCM();
  cm.sessions.set('p1', {
    product: makeProduct(),
    chatContext: { requirements: 'r' },
    status: 'waiting',
    goalReason: '',
    messages: [{ role: 'self', content: '1', time: 1, fingerprint: 'self:1' }],
    chatHistory: [{ role: 'assistant', content: '1' }],
    lastChecked: 9,
    backoffLevel: 0,
  });
  const [d] = cm.getSessionsFullData();
  assert.equal(d.messages[0].fingerprint, 'self:1');
  assert.deepEqual(d.chatHistory, [{ role: 'assistant', content: '1' }]);
  assert.equal(d.product.title, 'MacBook Air M2');
});

test('cleanup: 清空会话且容忍 page 为 null', async () => {
  const { cm } = makeCM();
  cm.sessions.set('p1', { status: 'waiting', page: null });
  await cm.cleanup();
  assert.equal(cm.sessions.size, 0);
});

test('restoreSessions + getSessionsFullData 往返一致性', () => {
  const { cm } = makeCM();
  const saved = [{
    id: 'p1',
    product: makeProduct(),
    chatContext: { requirements: 'r', chatStrategy: 's' },
    status: 'waiting',
    goalReason: '',
    messages: [
      { role: 'self', content: '你好', time: 1, fingerprint: 'self:你好' },
      { role: 'other', content: '在的', time: 2, fingerprint: 'other:在的' },
    ],
    chatHistory: [
      { role: 'assistant', content: '你好' },
      { role: 'user', content: '在的' },
    ],
  }];
  cm.restoreSessions(saved, {});
  const [out] = cm.getSessionsFullData();
  assert.equal(out.id, 'p1');
  assert.equal(out.messages.length, 2);
  assert.equal(out.messages[1].fingerprint, 'other:在的');
  assert.deepEqual(out.chatHistory, saved[0].chatHistory);
});