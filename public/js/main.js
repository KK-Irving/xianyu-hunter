// 入口：装配各模块并初始化。
import { connectWS } from './ws.js';
import { bindEvents } from './events.js';
import { loadDefaults, loadProviders, loadCurrentConfig, loadModel } from './modals.js';

function init() {
  bindEvents();
  connectWS();
  loadDefaults();
  loadProviders().then(() => loadCurrentConfig());
  loadModel();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}