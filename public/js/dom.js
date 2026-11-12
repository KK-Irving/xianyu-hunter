// DOM 查询与通用工具。

/** 按 id 取元素 */
export const $ = (id) => document.getElementById(id);

/** 按选择器取单个/多个元素 */
export const $$ = (sel, root = document) => root.querySelector(sel);
export const $$$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * HTML 转义，覆盖 & < > " ' 五个字符，
 * 避免用户可控文本破坏 innerHTML 或属性上下文。
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 显示/隐藏元素 */
export function show(el, display = 'block') {
  if (el) el.style.display = display;
}
export function hide(el) {
  if (el) el.style.display = 'none';
}