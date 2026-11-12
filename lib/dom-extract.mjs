/**
 * 闲鱼 IM 聊天页面的 DOM 消息提取与相关小工具。
 *
 * 把与页面结构强耦合的提取逻辑从 ChatManager 中剥离，便于在闲鱼改版时集中维护选择器。
 */

/**
 * 生成消息指纹的基准串（同一角色+同样文本 = 同一条消息）。
 * 连续相同消息的 "#序号" 后缀由调用方（DOM 计数或 session 计数）决定。
 */
export function msgFingerprint(role, content) {
  return `${role}:${content.trim()}`;
}

/**
 * 从 URL 中提取指定参数值。URL 不合法时退化为正则匹配。
 */
export function extractUrlParam(url, param) {
  try {
    const u = new URL(url);
    return u.searchParams.get(param) || '';
  } catch {
    const match = url.match(new RegExp(`[?&]${param}=([^&]*)`));
    return match ? match[1] : '';
  }
}

/**
 * 在闲鱼 IM 页面上精确提取所有消息。
 *
 * DOM 结构关键点：
 * - 消息列表在 #message-list-scrollable > .ant-list-items 下
 * - 每条消息是 li.ant-list-item
 * - 自己的消息: li 的 style 含 "direction: rtl"，文本 class 含 "message-text-right"
 * - 对方的消息: li 的 style 含 "direction: ltr"，文本 class 含 "message-text-left"
 * - 发送者名称在 message-row 内第一个小字体 div
 * - 消息文本在 div[class*="message-text"] 的 span 中
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{role:string,content:string,senderName:string,fingerprint:string,time:number}>>}
 */
export async function extractMessages(page) {
  return page.evaluate(() => {
    const results = [];
    const roleCounters = {};

    const msgRows = document.querySelectorAll('[class*="message-row"]');

    for (const row of msgRows) {
      const li = row.closest('li');
      if (!li) continue;

      const liStyle = li.getAttribute('style') || '';
      let role;
      if (liStyle.includes('direction: rtl') || liStyle.includes('direction:rtl')) {
        role = 'self';
      } else if (liStyle.includes('direction: ltr') || liStyle.includes('direction:ltr')) {
        role = 'other';
      } else {
        // 备用判断：检查 message-text 的 class
        const textEl = row.querySelector('[class*="message-text"]');
        if (!textEl) continue;
        const cls = textEl.className || '';
        if (cls.includes('right')) {
          role = 'self';
        } else if (cls.includes('left')) {
          role = 'other';
        } else {
          continue;
        }
      }

      // 提取发送者名称
      // 在 message-row 内，sender name 是 font-size: 12px 的那个 div
      let senderName = '';
      const allDivs = row.querySelectorAll('div');
      for (const d of allDivs) {
        const s = d.getAttribute('style') || '';
        if (s.includes('font-size: 12px') && s.includes('color: rgb(102, 102, 102)')) {
          senderName = d.textContent.trim();
          break;
        }
      }

      // 提取消息文本
      const textEl = row.querySelector('[class*="message-text"]');
      if (!textEl) continue;

      // 文本可能在 span 子元素中，或直接是 textContent
      const spans = textEl.querySelectorAll('span');
      let content = '';
      if (spans.length > 0) {
        content = [...spans].map(s => s.textContent.trim()).join('');
      }
      if (!content) {
        content = textEl.textContent.trim();
      }

      if (!content || content.length > 500) continue;

      // 处理同一 role 连续发同内容消息的去重序号
      const baseKey = `${role}:${content}`;
      roleCounters[baseKey] = (roleCounters[baseKey] || 0) + 1;
      const count = roleCounters[baseKey];
      const fingerprint = count > 1 ? `${baseKey}#${count}` : baseKey;

      results.push({
        role,
        content,
        senderName,
        fingerprint,
        time: Date.now(),
      });
    }

    return results;
  });
}