// 任务相关动作：组合 api 调用 + 弹窗 + 渲染刷新。
import { $ } from './dom.js';
import { state, findTask, upsertTask, removeTask } from './state.js';
import * as api from './api.js';
import { renderTaskList, renderTaskDetail, selectTaskRender } from './render.js';
import {
  hideCreateModal, clearForm, showCreateModal, hideStartModal,
} from './modals.js';

export async function createTask() {
  const queriesRaw = $('f-queries').value.trim();
  if (!queriesRaw) {
    alert('请输入至少一个搜索关键词');
    return;
  }
  const queries = queriesRaw.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const name = $('f-name').value.trim();
  const priceMin = $('f-price-min').value;
  const priceMax = $('f-price-max').value;
  const maxPages = $('f-pages').value;

  try {
    await api.createTask({
      name: name || queries[0],
      queries,
      priceMin: priceMin ? Number(priceMin) : null,
      priceMax: priceMax ? Number(priceMax) : null,
      maxPages: maxPages ? Number(maxPages) : 3,
      region: $('f-region').value.trim(),
      personalSeller: $('f-personal').checked,
      customRequirements: $('f-requirements').value.trim(),
      chatStrategy: $('f-chat-strategy').value.trim(),
      persona: $('f-persona').value.trim() || '',
      coarsePrompt: $('f-coarse-prompt').value.trim() || '',
      finePrompt: $('f-fine-prompt').value.trim() || '',
    });
    hideCreateModal();
    clearForm();
  } catch (err) {
    alert(err.message);
  }
}

export async function confirmStartTask() {
  if (!state.pendingStartTaskId) return;
  const chatStrategy = $('s-chat-strategy').value.trim();
  const persona = $('s-persona').value.trim();
  try {
    await api.startTask(state.pendingStartTaskId, { chatStrategy, persona });
    hideStartModal();
  } catch (err) {
    alert(err.message);
  }
}

export async function stopTask(id) {
  try { await api.stopTask(id); } catch (err) { alert(err.message); }
}

export function duplicateTask(id) {
  const task = findTask(id);
  if (!task?.config) return;
  const c = task.config;
  $('f-name').value = task.name ? `${task.name} (副本)` : '';
  $('f-queries').value = (c.queries || []).join(', ');
  $('f-price-min').value = c.priceMin ?? '';
  $('f-price-max').value = c.priceMax ?? '';
  $('f-pages').value = c.maxPages || 3;
  $('f-region').value = c.region || '';
  $('f-personal').checked = !!c.personalSeller;
  $('f-requirements').value = c.customRequirements || '';
  $('f-chat-strategy').value = c.chatStrategy || '';
  $('f-persona').value = c.persona || state.defaultPersona;
  $('f-coarse-prompt').value = c.coarsePrompt || state.defaultCoarsePrompt;
  $('f-fine-prompt').value = c.finePrompt || state.defaultFinePrompt;
  showCreateModal();
}

export async function deleteTask(id) {
  if (!confirm('确认删除此任务？')) return;
  try { await api.deleteTask(id); } catch { /* ignore */ }
  removeTask(id);
  if (state.activeTaskId === id) {
    state.activeTaskId = null;
    renderTaskDetail();
  }
  renderTaskList();
}

export { selectTaskRender };