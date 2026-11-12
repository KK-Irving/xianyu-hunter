// 事件委托总线：用 data-action 把 DOM 事件路由到各处理函数，
// 取代原先散落在 HTML 里的内联 onclick/onchange。
import { $, $$$ } from './dom.js';
import * as modals from './modals.js';
import * as actions from './actions.js';

// data-action => 处理函数。需要 data-task-id 的从 dataset 取。
const clickActions = {
  'show-settings': () => modals.showSettingsModal(),
  'hide-settings': () => modals.hideSettingsModal(),
  'save-settings': () => modals.saveSettings(),
  'test-api': () => modals.testApiConfig(),
  'toggle-pwd': () => modals.toggleApiKeyVisibility(),
  'add-model': () => modals.addCustomModel(),
  'remove-model': (el) => modals.removeCustomModel(el.dataset.modelId),

  'show-create': () => modals.showCreateModal(),
  'hide-create': () => modals.hideCreateModal(),
  'create-task': () => actions.createTask(),
  'reset-persona': () => modals.resetPersona(),
  'reset-coarse': () => modals.resetCoarsePrompt(),
  'reset-fine': () => modals.resetFinePrompt(),

  'hide-start': () => modals.hideStartModal(),
  'confirm-start': () => actions.confirmStartTask(),

  'select-task': (el) => actions.selectTaskRender(el.dataset.taskId),
  'start-task': (el) => modals.openStartModal(el.dataset.taskId),
  'stop-task': (el) => actions.stopTask(el.dataset.taskId),
  'duplicate-task': (el) => actions.duplicateTask(el.dataset.taskId),
  'delete-task': (el) => actions.deleteTask(el.dataset.taskId),
};

export function bindEvents() {
  // 统一点击委托
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const handler = clickActions[action];
    if (handler) {
      handler(target, e);
    }
  });

  // Tab 切换
  $$$('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // 模型下拉切换
  $('model-select')?.addEventListener('change', (e) => modals.switchModel(e.target.value));

  // 服务商切换
  $('cfg-provider')?.addEventListener('change', (e) => modals.onProviderChange(e.target.value));

  // 弹窗点击遮罩关闭 + 阻止内容区冒泡
  bindModalBackdrop('settings-modal-overlay', () => modals.hideSettingsModal());
  bindModalBackdrop('modal-overlay', () => modals.hideCreateModal());
  bindModalBackdrop('start-modal-overlay', () => modals.hideStartModal());

  // 自定义模型输入框回车添加
  $('cfg-custom-model')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); modals.addCustomModel(); }
  });
}

function bindModalBackdrop(overlayId, onClose) {
  const overlay = $(overlayId);
  if (!overlay) return;
  overlay.addEventListener('click', (e) => {
    // 只有点击遮罩本身（而非内部 .modal）才关闭
    if (e.target === overlay) onClose();
  });
}

export function switchTab(tab) {
  $$$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$$('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));
}