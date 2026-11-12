/**
 * 闲鱼（DingTalk IMPaaS）WebSocket 协议解析。
 *
 * 职责：把服务端 /s/sync 帧里 bizType=40 的二进制聊天数据解析成结构化消息。
 * 纯函数、无副作用，便于单测与在协议改版时集中维护正则。
 */

/**
 * 将一条 syncPushPackage.data[item] 的 base64 数据解码为 UTF-8 字符串。
 * 解码失败抛出异常，由调用方捕获。
 * @param {string} base64Data item.data 字段
 * @returns {string} 解码后的二进制可读字符串
 */
export function decodeWsFrameItem(base64Data) {
  const binary = atob(base64Data);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * 从解码后的字符串中提取消息信息。
 * 数据格式：二进制协议中嵌入了 JSON 和可读字段。
 * @param {string} decoded decodeWsFrameItem 的输出
 * @returns {{senderUserId:string,text:string,senderName:string,itemId:string,peerUserId:string}|null}
 *          无法提取出必要字段（text / senderUserId）时返回 null
 */
export function parseWsMessage(decoded) {
  if (typeof decoded !== 'string' || !decoded) return null;

  // 提取 senderUserId
  const senderMatch = decoded.match(/senderUserId\x00?(.+?)(?:\x00|\x01)/);
  const senderUserId = senderMatch ? senderMatch[1].replace(/[^\d]/g, '') : '';

  // 提取消息内容 JSON
  const contentMatch = decoded.match(/\{"atUsers".*?"text":\{"text":"((?:[^"\\]|\\.)*)"\}\}/);
  const text = contentMatch ? contentMatch[1] : '';

  // 提取 reminderTitle（发送者昵称）
  const titleMatch = decoded.match(/reminderTitle\x00?(.+?)(?:\x00|\x01)/);
  const senderName = titleMatch ? titleMatch[1].replace(/[\x00-\x1f]/g, '').trim() : '';

  // 提取 itemId（从 reminderUrl）
  const itemIdMatch = decoded.match(/itemId=(\d+)/);
  const itemId = itemIdMatch ? itemIdMatch[1] : '';

  // 提取 peerUserId（从 reminderUrl）
  const peerMatch = decoded.match(/peerUserId=(\d+)/);
  const peerUserId = peerMatch ? peerMatch[1] : '';

  if (!text || !senderUserId) return null;

  return { senderUserId, text, senderName, itemId, peerUserId };
}

/**
 * 判断一个解析后的 WS 帧是否是服务端推送的 /s/sync 聊天同步帧，
 * 是则返回其中 bizType=40 的 data 项数组，否则返回空数组。
 * @param {any} frame JSON.parse 后的帧对象
 * @returns {Array} bizType=40 的 data 项
 */
export function extractChatItems(frame) {
  if (!frame || frame.lwp !== '/s/sync') return [];
  const data = frame.body?.syncPushPackage?.data;
  if (!Array.isArray(data)) return [];
  return data.filter(item => item && item.bizType === 40);
}