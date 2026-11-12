// 弹窗（设置 / 新建任务 / 启动任务）开关与表单逻辑，
// 以及配置横幅、模型下拉、自定义模型标签。
import { $, escapeHtml } from './dom.js';
import { state } from './state.js';
import * as api from './api.js';

// ==================== 配置横幅 ====================

export function showConfigBanner() {
  const b = $('config-banner');
  if (b) b.style.display = 'flex';
  $('settings-btn')?.classList.add('pulse');
}

export function hideConfigBanner() {
  const b = $('config-banner');
  if (b) b.style.display = 'none';
  $('settings-btn')?.classList.remove('pulse');
}

// ==================== 模型下拉 ====================

export async function loadModel() {
  try {
    const data = await api.getModel();
    const select = $('model-select');
    if (!select) return;
    if (data.models && data.models.length > 0) {
      select.innerHTML = data.models.map(m =>
        `<option value="${escapeHtml(m.id)}" ${m.id === data.current ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
      ).join('');
    } else {
      select.innerHTML = '<option value="">未配置</option>';
    }
  } catch { /* ignore */ }
}

export function setModelSelectValue(current) {
  const select = $('model-select');
  if (select) select.value = current;
}

export async function switchModel(modelId) {
  try { await api.setModel(modelId); } catch { /* ignore */ }
}

// ==================== 设置弹窗 ====================

export async function loadProviders() {
  try {
    state.providers = await api.getProviders();
    const select = $('cfg-provider');
    if (!select) return;
    select.innerHTML = '<option value="">-- 请选择 --</option>' +
      state.providers.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
  } catch { /* ignore */ }
}

export async function loadCurrentConfig() {
  try { state.currentConfig = await api.getConfig(); } catch { /* ignore */ }
}

export function showSettingsModal() {
  populateSettingsForm();
  $('settings-modal-overlay')?.classList.add('show');
  const tr = $('test-result');
  if (tr) tr.textContent = '';
}

export function hideSettingsModal() {
  $('settings-modal-overlay')?.classList.remove('show');
}

function populateSettingsForm() {
  const cfg = state.currentConfig;
  $('cfg-provider').value = cfg.provider || '';
  $('cfg-base-url').value = cfg.baseUrl || '';
  $('cfg-api-key').value = '';
  $('cfg-api-key').placeholder = cfg.hasKey ? '已配置（留空保持不变）' : 'sk-...';

  state.customModels = (cfg.customModels || []).map(m =>
    typeof m === 'string' ? { id: m, name: m } : m
  );

  onProviderChange(cfg.provider || '', cfg.model);
  renderCustomModelTags();
}

export function onProviderChange(providerId, preserveModel) {
  const provider = state.providers.find(p => p.id === providerId);
  const baseUrlInput = $('cfg-base-url');
  const modelSelect = $('cfg-model');

  if (provider) {
    if (provider.baseUrl) baseUrlInput.value = provider.baseUrl;
    if (providerId === 'custom') baseUrlInput.value = state.currentConfig.baseUrl || '';
  }

  const models = provider?.models || [];
  const allModels = [...models, ...state.customModels];

  if (allModels.length > 0) {
    modelSelect.innerHTML = allModels.map(m =>
      `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`
    ).join('');
  } else {
    modelSelect.innerHTML = '<option value="">请添加自定义模型</option>';
  }

  const targetModel = preserveModel || state.currentConfig.model;
  if (targetModel && allModels.some(m => m.id === targetModel)) {
    modelSelect.value = targetModel;
  }
}

export function addCustomModel() {
  const input = $('cfg-custom-model');
  const modelId = input.value.trim();
  if (!modelId) return;
  if (state.customModels.some(m => m.id === modelId)) return;

  state.customModels.push({ id: modelId, name: modelId });
  input.value = '';
  renderCustomModelTags();
  onProviderChange($('cfg-provider').value, modelId);
}

export function removeCustomModel(modelId) {
  state.customModels = state.customModels.filter(m => m.id !== modelId);
  renderCustomModelTags();
  onProviderChange($('cfg-provider').value);
}

function renderCustomModelTags() {
  const container = $('custom-model-tags');
  if (!container) return;
  // data 属性承载 id，删除按钮由事件委托处理（见 events.js）
  container.innerHTML = state.customModels.map(m =>
    `<span class="model-tag">${escapeHtml(m.id)} <button type="button" class="model-tag-remove" data-action="remove-model" data-model-id="${escapeHtml(m.id)}">&times;</button></span>`
  ).join('');
}

export function toggleApiKeyVisibility() {
  const input = $('cfg-api-key');
  input.type = input.type === 'password' ? 'text' : 'password';
}

export async function testApiConfig() {
  const btn = $('test-api-btn');
  const result = $('test-result');
  btn.disabled = true;
  result.textContent = '测试中...';
  result.className = 'test-result';

  try {
    await saveSettingsQuiet();
    const data = await api.testConfig();
    if (data.ok) {
      result.textContent = `✅ 连接成功！模型: ${data.model}，回复: "${data.reply}"`;
      result.className = 'test-result success';
    } else {
      result.textContent = `❌ ${data.error}`;
      result.className = 'test-result error';
    }
  } catch (err) {
    result.textContent = `❌ 请求失败: ${err.message}`;
    result.className = 'test-result error';
  } finally {
    btn.disabled = false;
  }
}

async function saveSettingsQuiet() {
  const provider = $('cfg-provider').value;
  const baseUrl = $('cfg-base-url').value.trim();
  const apiKey = $('cfg-api-key').value.trim();
  const model = $('cfg-model').value;

  const body = { provider, baseUrl, model, customModels: state.customModels };
  if (apiKey) body.apiKey = apiKey;

  const data = await api.saveConfig(body);
  if (data.config) state.currentConfig = data.config;
  return data;
}

export async function saveSettings() {
  try {
    const data = await saveSettingsQuiet();
    if (data.ok) {
      hideSettingsModal();
      loadModel();
      if (state.currentConfig.hasKey) hideConfigBanner();
    }
  } catch (err) {
    alert('保存失败: ' + err.message);
  }
}

// ==================== 新建任务弹窗 ====================

export function showCreateModal() {
  $('modal-overlay')?.classList.add('show');
}

export function hideCreateModal() {
  $('modal-overlay')?.classList.remove('show');
}

export function clearForm() {
  ['f-name', 'f-queries', 'f-price-min', 'f-price-max', 'f-region', 'f-requirements', 'f-chat-strategy']
    .forEach(id => { const el = $(id); if (el) el.value = ''; });
  $('f-pages').value = '3';
  $('f-personal').checked = false;
  $('f-persona').value = state.defaultPersona;
  $('f-coarse-prompt').value = state.defaultCoarsePrompt;
  $('f-fine-prompt').value = state.defaultFinePrompt;
}

export function resetPersona() { $('f-persona').value = state.defaultPersona; }
export function resetCoarsePrompt() { $('f-coarse-prompt').value = state.defaultCoarsePrompt; }
export function resetFinePrompt() { $('f-fine-prompt').value = state.defaultFinePrompt; }

export async function loadDefaults() {
  try {
    const data = await api.getDefaults();
    state.defaultPersona = data.persona || '';
    state.defaultCoarsePrompt = data.coarsePrompt || '';
    state.defaultFinePrompt = data.finePrompt || '';
    $('f-persona').value = state.defaultPersona;
    $('f-coarse-prompt').value = state.defaultCoarsePrompt;
    $('f-fine-prompt').value = state.defaultFinePrompt;
  } catch { /* ignore */ }
}

// ==================== 启动任务弹窗 ====================

export function openStartModal(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  state.pendingStartTaskId = id;
  $('start-modal-task-name').textContent = `任务: ${task.name}`;
  $('s-chat-strategy').value = task.config?.chatStrategy || '';
  $('s-persona').value = task.config?.persona || state.defaultPersona;
  $('start-modal-overlay')?.classList.add('show');
}

export function hideStartModal() {
  $('start-modal-overlay')?.classList.remove('show');
  state.pendingStartTaskId = null;
}