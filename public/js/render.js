// 所有视图渲染。列表尽量增量更新，减少全量重绘带来的闪烁与滚动丢失。
import { $, escapeHtml, show, hide } from './dom.js';
import { state, findTask, upsertTask } from './state.js';
import { getTask } from './api.js';

export const STAGE_LABELS = {
  pending: '等待中', login: '登录验证', searching: '搜索采集',
  coarse_filter: '粗筛', fine_filter: '细筛', chatting: '询价中',
  completed: '已完成', stopped: '已停止', stopping: '停止中',
};

export const STAGES_ORDER = ['login', 'searching', 'coarse_filter', 'fine_filter', 'chatting'];

// ==================== 任务列表（增量） ====================

function taskCardHtml(t) {
  const stageLabel = STAGE_LABELS[t.stage] || t.stage;
  const count = t.products ? `${t.products.rawCount || 0}件` : '';
  return `
    <div class="task-card-name">${escapeHtml(t.name)}</div>
    <div class="task-card-meta">
      <span class="stage-badge stage-${t.stage}">${stageLabel}</span>
      <span style="font-size:11px;color:var(--text2)">${count}</span>
    </div>`;
}

export function renderTaskList() {
  const container = $('task-list');
  if (!container) return;

  const existing = new Map(
    [...container.children].map(el => [el.dataset.taskId, el])
  );
  const seen = new Set();

  state.tasks.forEach(t => {
    seen.add(t.id);
    let card = existing.get(t.id);
    if (!card) {
      card = document.createElement('div');
      card.dataset.taskId = t.id;
      card.dataset.action = 'select-task';
      container.appendChild(card);
    }
    card.className = `task-card ${t.id === state.activeTaskId ? 'active' : ''}`;
    const next = taskCardHtml(t);
    if (card.__html !== next) {
      card.innerHTML = next;
      card.__html = next;
    }
  });

  // 删除已不存在的任务卡
  existing.forEach((el, id) => {
    if (!seen.has(id)) el.remove();
  });

  // 维持与 state.tasks 相同的顺序
  state.tasks.forEach((t, i) => {
    const card = container.children[i];
    const want = [...container.children].find(c => c.dataset.taskId === t.id);
    if (card !== want && want) container.insertBefore(want, card || null);
  });
}

export function selectTaskRender(id) {
  state.activeTaskId = id;
  renderTaskList();
  getTask(id).then(task => {
    upsertTask(task);
    renderTaskDetail();
  });
}

// ==================== 任务详情 ====================

export function renderTaskDetail() {
  const task = findTask(state.activeTaskId);
  const detail = $('task-detail');
  const empty = $('empty-state');

  if (!task) {
    hide(detail);
    show(empty, 'flex');
    return;
  }
  show(detail, 'flex');
  hide(empty);

  renderPipeline();
  renderProductStats();
  renderProducts();
  renderChats();
  renderLogs();
}

export function renderPipeline() {
  const task = findTask(state.activeTaskId);
  if (!task) return;
  const currentIdx = STAGES_ORDER.indexOf(task.stage);
  const container = $('pipeline');
  if (!container) return;

  let html = STAGES_ORDER.map((stage, i) => {
    let cls = '';
    if (task.stage === 'completed') cls = 'done';
    else if (task.stage === 'stopped' || task.stage === 'stopping') cls = i <= currentIdx ? 'done' : '';
    else if (i < currentIdx) cls = 'done';
    else if (i === currentIdx) cls = 'active';
    return `
      ${i > 0 ? '<span class="pipeline-arrow">→</span>' : ''}
      <div class="pipeline-step ${cls}">${STAGE_LABELS[stage]}</div>`;
  }).join('');

  html += `
    <div class="pipeline-controls">
      <button class="btn btn-sm" data-action="duplicate-task" data-task-id="${task.id}" title="复制任务配置">复制</button>
      ${task.running
        ? `<button class="btn btn-danger btn-sm" data-action="stop-task" data-task-id="${task.id}">停止任务</button>`
        : `<button class="btn btn-sm" style="color:var(--green)" data-action="start-task" data-task-id="${task.id}">启动</button>
           <button class="btn btn-sm" data-action="delete-task" data-task-id="${task.id}">删除</button>`
      }
    </div>`;
  container.innerHTML = html;
}

export function renderProductStats() {
  const task = findTask(state.activeTaskId);
  if (!task?.products) return;
  const el = $('product-stats');
  if (!el) return;
  el.innerHTML = `
    <div class="stat-card"><div class="stat-value">${task.products.rawCount || 0}</div><div class="stat-label">采集总量</div></div>
    <div class="stat-card"><div class="stat-value" style="color:var(--orange)">${task.products.coarseCount || 0}</div><div class="stat-label">粗筛通过</div></div>
    <div class="stat-card"><div class="stat-value" style="color:var(--green)">${task.products.fineCount || 0}</div><div class="stat-label">细筛通过</div></div>
    <div class="stat-card"><div class="stat-value" style="color:var(--accent)">${task.chatSessions?.length || 0}</div><div class="stat-label">聊天会话</div></div>`;
}

export function renderProducts() {
  const task = findTask(state.activeTaskId);
  if (!task?.products) return;
  const tbody = $('product-tbody');
  if (!tbody) return;

  const fineIds = new Set((task.products.fineFiltered || []).map(p => p.id));
  const coarseIds = new Set((task.products.coarseFiltered || []).map(p => p.id));
  const chatIds = new Set((task.chatSessions || []).map(s => s.id));
  const all = task.products.raw || [];

  tbody.innerHTML = all.map(p => {
    let badge, badgeCls;
    if (chatIds.has(p.id)) { badge = '聊天中'; badgeCls = 'badge-chat'; }
    else if (fineIds.has(p.id)) { badge = '细筛✓'; badgeCls = 'badge-fine'; }
    else if (coarseIds.has(p.id)) { badge = '粗筛✓'; badgeCls = 'badge-coarse'; }
    else { badge = '采集'; badgeCls = 'badge-raw'; }

    return `<tr>
      <td>${p.image ? `<img class="product-img" src="${escapeHtml(p.image)}" loading="lazy">` : '-'}</td>
      <td class="product-title" title="${escapeHtml(p.title)}">${escapeHtml(p.title?.slice(0, 60) || '')}</td>
      <td class="product-price">${escapeHtml(p.price || '')}</td>
      <td>${escapeHtml(p.sellerLocation || '')}</td>
      <td><span class="badge ${badgeCls}">${badge}</span></td>
    </tr>`;
  }).join('');
}

export function renderChats() {
  const task = findTask(state.activeTaskId);
  const container = $('chat-sessions');
  if (!container) return;
  const sessions = task?.chatSessions || [];

  if (sessions.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:40px"><p style="color:var(--text2)">暂无聊天会话</p></div>';
    return;
  }

  const statusMap = { initiating: '发起中', waiting: '监控中', error: '异常', goal_reached: '目标达成' };

  container.innerHTML = sessions.map(s => {
    const ps = s.promptSummary || {};
    const statusLabel = statusMap[s.status] || s.status;
    const statusCls = s.status === 'goal_reached' ? 'goal'
      : s.status === 'waiting' ? 'chatting'
      : s.status === 'error' ? 'stopped' : 'pending';
    return `
    <div class="chat-session ${s.status === 'goal_reached' ? 'chat-goal-reached' : ''}">
      <div class="chat-header">
        <div>
          <span class="chat-product-name">${escapeHtml(s.productTitle?.slice(0, 40) || '')}</span>
          <span class="chat-product-price">${escapeHtml(s.productPrice || '')}</span>
          ${s.sellerName ? `<span class="chat-seller">@${escapeHtml(s.sellerName)}</span>` : ''}
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="prompt-tag ${ps.hasStrategy ? 'on' : ''}">策略</span>
          <span class="prompt-tag ${ps.hasProductContext ? 'on' : ''}">商品</span>
          <span class="prompt-tag ${ps.hasRequirements ? 'on' : ''}">需求</span>
          <span class="chat-msg-count">${s.messageCount || 0}条</span>
          <span class="stage-badge stage-${statusCls}">${statusLabel}</span>
        </div>
      </div>
      ${s.status === 'goal_reached' && s.goalReason ? `
      <div class="chat-goal-banner">🎯 ${escapeHtml(s.goalReason)}</div>` : ''}
      ${s.productDescription ? `
      <div class="chat-context">
        <div class="chat-context-label">卖家商品描述</div>
        <div class="chat-context-text">${escapeHtml(s.productDescription)}</div>
      </div>` : ''}
      <div class="chat-messages">
        ${(s.messages || []).map(m => {
          const timeStr = m.time ? new Date(m.time).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '';
          return `
          <div class="chat-msg ${m.role === 'self' ? 'self' : 'other'}">
            <div class="chat-bubble">${escapeHtml(m.content)}</div>
            ${timeStr ? `<div class="chat-msg-time">${timeStr}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.chat-messages').forEach(box => {
    box.scrollTop = box.scrollHeight;
  });
}

export function renderLogs() {
  const task = findTask(state.activeTaskId);
  const panel = $('log-panel');
  if (!panel) return;
  const logs = task?.logs || [];
  panel.innerHTML = logs.map(l =>
    `<div class="log-entry"><span class="log-time">${escapeHtml(l.time)}</span>${escapeHtml(l.message)}</div>`
  ).join('');
  panel.scrollTop = panel.scrollHeight;
}

// ==================== WS 增量辅助 ====================

export function appendLogLive(taskId, entry) {
  const task = findTask(taskId);
  if (!task) return;
  if (!task.logs) task.logs = [];
  task.logs.push(entry);
  if (task.logs.length > 500) task.logs = task.logs.slice(-300);

  if (state.activeTaskId === taskId) {
    const panel = $('log-panel');
    if (!panel) return;
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = `<span class="log-time">${escapeHtml(entry.time)}</span>${escapeHtml(entry.message)}`;
    panel.appendChild(div);
    panel.scrollTop = panel.scrollHeight;
  }
}

export function updateProductCounts(taskId, data) {
  const task = findTask(taskId);
  if (!task) return;
  if (!task.products) task.products = {};
  task.products.rawCount = data.rawCount;
  task.products.coarseCount = data.coarseCount;
  task.products.fineCount = data.fineCount;
}