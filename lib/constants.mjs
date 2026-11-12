/**
 * 集中管理行为参数（延迟、批大小、超时、间隔等）。
 * 把散落在各模块的魔法数字收敛到一处，便于统一调参与理解。
 */

// ========== 浏览器 / 页面 ==========
export const NAV_TIMEOUT_MS = 30000;        // page.goto 导航超时
export const CHAT_READY_TIMEOUT_MS = 15000; // 等待聊天消息列表出现
export const WS_CONNECT_TIMEOUT_MS = 15000; // 等待 WebSocket 建立

// ========== 筛选 ==========
export const COARSE_BATCH_SIZE = 15;        // 粗筛每批送 AI 的标题数
export const COARSE_BATCH_DELAY = [1000, 2000];  // 粗筛批间延迟 [min, max]
export const FINE_ITEM_DELAY = [5000, 12000];    // 细筛每个商品间延迟

// ========== 搜索 ==========
export const SEARCH_PAGE_DELAY = [3000, 6000];   // 翻页间延迟
export const AUTOSCROLL_MAX_MS = 8000;           // 自动滚动最长时间

// ========== 聊天 ==========
export const CHAT_MSG_DELAY = [2500, 4000];      // 连续发送消息间延迟
export const CATCHUP_SESSION_DELAY = [2000, 4000]; // 补漏逐会话间延迟
export const CHAT_RECONNECT_DELAY = [3000, 6000];  // WS 重连前延迟
export const WS_MAX_RECONNECTS = 10;             // WS 最大重连次数
export const WS_SWEEP_INTERVAL_MS = 3 * 60 * 1000; // 定时 DOM 兜底间隔
export const CHAT_NEXT_PRODUCT_DELAY_BASE = 8000;  // 下个商品基础等待
export const CHAT_NEXT_PRODUCT_DELAY_RAND = 12000; // 下个商品随机增量上限
export const GOAL_JUDGE_MIN_HISTORY = 6;         // 触发目标判定的最少对话条数

// 单条聊天消息最大字数（prompt 指引与代码过滤统一口径）
export const MAX_CHAT_MSG_LEN = 20;

// ========== 持久化 / 广播 ==========
export const PERSIST_THROTTLE_MS = 2000;    // 持久化节流最小间隔
export const PERSIST_INTERVAL_MS = 30000;   // 聊天监控期定时落盘间隔
export const CHAT_BROADCAST_INTERVAL_MS = 5000; // 聊天数据广播间隔

// ========== 校验 ==========
export const VERIFICATION_MAX_WAIT_MS = 300000;  // 等待人工校验最长时间
export const VERIFICATION_CHECK_INTERVAL_MS = 5000; // 校验轮询间隔

// ========== AI 上下文 ==========
export const GOAL_JUDGE_HISTORY_WINDOW = 20;  // 目标判定回看对话条数
export const SESSION_MSG_KEEP = 30;           // getSessionsData 保留最近消息条数