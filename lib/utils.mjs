import { VERIFICATION_MAX_WAIT_MS, VERIFICATION_CHECK_INTERVAL_MS } from './constants.mjs';

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function randomDelay(minMs, maxMs) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return sleep(ms);
}

export function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

export function genId() {
  return crypto.randomUUID().slice(0, 8);
}

export function parsePrice(text) {
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/[\d.]+/);
  return match ? parseFloat(match[0]) : null;
}

export function extractItemId(url) {
  const match = url.match(/[?&]id=(\d+)/);
  return match ? match[1] : null;
}

export function extractUserId(url) {
  const match = url.match(/[?&](?:userId|peerUserId)=(\d+)/);
  return match ? match[1] : null;
}

export function timestamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

/**
 * 从任意 LLM 输出中稳健地解析出 JSON。
 * 处理：```json 代码块包裹、JSON 前后夹带解释文字、首个对象/数组块提取。
 * 解析失败返回 fallback（默认 null）。
 *
 * @param {string} text 模型原始输出
 * @param {*} fallback 解析失败时的返回值
 * @returns {*} 解析出的 JSON 值或 fallback
 */
export function safeParseJSON(text, fallback = null) {
  if (text == null) return fallback;
  const raw = String(text).trim();
  if (!raw) return fallback;

  // 1) 去掉 markdown 代码围栏
  const unfenced = raw
    .replace(/```(?:json|JSON)?\s*/g, '')
    .replace(/```/g, '')
    .trim();

  // 2) 直接尝试整体解析
  const direct = tryParse(unfenced);
  if (direct.ok) return direct.value;

  // 3) 提取第一个平衡的 {...} 或 [...] 块再解析
  const block = extractFirstJsonBlock(unfenced);
  if (block != null) {
    const parsed = tryParse(block);
    if (parsed.ok) return parsed.value;
  }

  return fallback;
}

function tryParse(s) {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
}

/**
 * 扫描字符串，返回第一个括号平衡的 JSON 块（对象或数组），
 * 正确处理字符串字面量内的括号与转义。找不到返回 null。
 */
function extractFirstJsonBlock(s) {
  const startIdx = (() => {
    const objIdx = s.indexOf('{');
    const arrIdx = s.indexOf('[');
    if (objIdx === -1) return arrIdx;
    if (arrIdx === -1) return objIdx;
    return Math.min(objIdx, arrIdx);
  })();
  if (startIdx === -1) return null;

  const open = s[startIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let escaped = false;

  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return s.slice(startIdx, i + 1);
      }
    }
  }
  return null;
}

/**
 * 通用真人校验检测：检查当前页面是否触发了平台验证。
 * 如果检测到验证页面，会持续轮询等待用户手动完成（最长 maxWaitMs）。
 * @returns {Promise<boolean>} true=校验通过或无校验，false=超时或任务停止
 */
export async function waitIfVerification(page, { emitLog, shouldStop, label = '', maxWaitMs = VERIFICATION_MAX_WAIT_MS } = {}) {
  const prefix = label ? `[${label}] ` : '';
  const checkInterval = VERIFICATION_CHECK_INTERVAL_MS;
  let waited = 0;

  while (waited < maxWaitMs) {
    const hasVerify = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const url = location.href;
      if (url.includes('verify') || url.includes('captcha') || url.includes('checkcode')) return true;
      if (bodyText.includes('安全验证') || bodyText.includes('滑动验证')
        || bodyText.includes('请完成验证') || bodyText.includes('人机验证')
        || bodyText.includes('拖动滑块') || bodyText.includes('点击完成验证')) return true;
      const iframe = document.querySelector('iframe[src*="captcha"], iframe[src*="verify"]');
      if (iframe) return true;
      return false;
    }).catch(() => false);

    if (!hasVerify) return true;

    if (waited === 0) {
      if (emitLog) emitLog(`  ${prefix}🛑 检测到平台真人校验！请在浏览器中手动完成验证，完成后自动继续...`);
    }

    await sleep(checkInterval);
    waited += checkInterval;

    if (shouldStop && shouldStop()) {
      if (emitLog) emitLog(`  ${prefix}任务已停止，中断校验等待`);
      return false;
    }
  }

  if (emitLog) emitLog(`  ${prefix}⚠️ 等待校验超时（${Math.round(maxWaitMs / 60000)}分钟），跳过本次`);
  return false;
}
