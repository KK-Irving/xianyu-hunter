// WebSocket 连接管理与事件分发。
import { $ } from './dom.js';
import { state, findTask, upsertTask, updateTaskField } from './state.js';
import {
  renderTaskList, renderPipeline, renderProductStats, renderChats,
  renderTaskDetail, appendLogLive, updateProductCounts, selectTaskRender,
} from './render.js';
import { showConfigBanner, hideConfigBanner, setModelSelectValue, loadModel } from './modals.js';

let ws = null;

export function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    $('ws-status')?.classList.add('connected');
  };

  ws.onclose = () => {
    $('ws-status')?.classList.remove('connected');
    setTimeout(connectWS, 2000);
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleWSMessage(msg);
  };
}

function handleWSMessage(msg) {
  const { event, taskId, data } = msg;

  switch (event) {
    case 'connected':
      if (data?.tasks) {
        state.tasks = data.tasks;
        renderTaskList();
      }
      if (data?.configured === false) showConfigBanner();
      else hideConfigBanner();
      break;

    case 'task:created':
      upsertTask(data);
      renderTaskList();
      selectTaskRender(data.id);
      break;

    case 'task:started':
    case 'task:stopping':
      updateTaskField(taskId, 'running', event === 'task:started');
      if (event === 'task:stopping') updateTaskField(taskId, 'stage', 'stopping');
      renderTaskList();
      if (state.activeTaskId === taskId) renderPipeline();
      break;

    case 'task:stage':
      updateTaskField(taskId, 'stage', data.stage);
      renderTaskList();
      if (state.activeTaskId === taskId) renderPipeline();
      break;

    case 'task:log':
      appendLogLive(taskId, data);
      break;

    case 'task:products':
      updateProductCounts(taskId, data);
      if (state.activeTaskId === taskId) renderProductStats();
      break;

    case 'task:chats':
      updateTaskField(taskId, 'chatSessions', data);
      if (state.activeTaskId === taskId) renderChats();
      break;

    case 'task:finished':
      upsertTask(data);
      renderTaskList();
      if (state.activeTaskId === taskId) renderTaskDetail();
      break;

    case 'model:changed':
      if (data?.current) setModelSelectValue(data.current);
      break;

    case 'config:changed':
      if (data?.configured) hideConfigBanner();
      else showConfigBanner();
      if (data?.config) state.currentConfig = data.config;
      loadModel();
      break;
  }
}