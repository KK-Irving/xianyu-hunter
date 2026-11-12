import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { genId, timestamp, parsePrice } from './utils.mjs';
import {
  PERSIST_THROTTLE_MS, PERSIST_INTERVAL_MS, CHAT_BROADCAST_INTERVAL_MS,
  CHAT_NEXT_PRODUCT_DELAY_BASE, CHAT_NEXT_PRODUCT_DELAY_RAND,
} from './constants.mjs';
import { checkLogin } from './login.mjs';
import { searchProducts } from './search.mjs';
import { coarseFilter, fineFilter } from './filter.mjs';
import { ChatManager } from './chat.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

const STAGES = ['login', 'searching', 'coarse_filter', 'fine_filter', 'chatting'];

export class TaskManager {
  constructor(broadcast) {
    this.tasks = new Map();
    this.broadcast = broadcast;
    // 持久化节流状态
    this._persistTimer = null;
    this._persistInFlight = null;
    this._persistPendingWhileInFlight = false;
    this._persistMinIntervalMs = PERSIST_THROTTLE_MS;
    this._loadFromDisk();
  }

  _buildTaskConfig(config) {
    return {
      queries: config.queries || [],
      priceMin: config.priceMin ?? null,
      priceMax: config.priceMax ?? null,
      region: config.region || '',
      personalSeller: config.personalSeller || false,
      customRequirements: config.customRequirements || '',
      chatStrategy: config.chatStrategy || '',
      persona: config.persona || '',
      coarsePrompt: config.coarsePrompt || '',
      finePrompt: config.finePrompt || '',
      maxPages: config.maxPages || 3,
    };
  }

  createTask(config) {
    const id = genId();
    const task = {
      id,
      name: config.name || `任务-${id}`,
      config: this._buildTaskConfig(config),
      stage: 'pending',
      running: false,
      stopped: false,
      products: { raw: [], coarseFiltered: [], fineFiltered: [] },
      chatSessions: [],
      chatSessionsFull: [],
      logs: [],
      createdAt: Date.now(),
    };

    this.tasks.set(id, task);
    this._persistToDisk();
    this._emit(id, 'task:created', this._serialize(task));
    return task;
  }

  duplicateTask(sourceId) {
    const source = this.tasks.get(sourceId);
    if (!source) return null;

    const id = genId();
    const task = {
      id,
      name: `${source.name} (副本)`,
      config: { ...source.config },
      stage: 'pending',
      running: false,
      stopped: false,
      products: { raw: [], coarseFiltered: [], fineFiltered: [] },
      chatSessions: [],
      chatSessionsFull: [],
      logs: [],
      createdAt: Date.now(),
    };

    this.tasks.set(id, task);
    this._persistToDisk();
    this._emit(id, 'task:created', this._serialize(task));
    return task;
  }

  async startTask(id, configUpdates = {}) {
    const task = this.tasks.get(id);
    if (!task || task.running) return;

    if (configUpdates.chatStrategy !== undefined) {
      task.config.chatStrategy = configUpdates.chatStrategy;
    }
    if (configUpdates.persona !== undefined) {
      task.config.persona = configUpdates.persona;
    }

    task.running = true;
    task.stopped = false;
    this._persistToDisk();
    this._emit(id, 'task:started', { id });

    const emitLog = (msg) => {
      const entry = { time: timestamp(), message: msg };
      task.logs.push(entry);
      this._emit(id, 'task:log', entry);
    };

    const shouldStop = () => task.stopped;

    try {
      await this._runPipeline(task, emitLog, shouldStop);
      if (!task.stopped) {
        task.stage = 'completed';
      }
    } catch (err) {
      emitLog(`❌ 任务异常: ${err.message}`);
    } finally {
      task.running = false;
      if (task.stopped) {
        task.stage = 'stopped';
      }
      await this._flushToDisk();
      this._emit(id, 'task:finished', this._serialize(task));
    }
  }

  stopTask(id) {
    const task = this.tasks.get(id);
    if (!task) return;
    task.stopped = true;
    task.stage = 'stopping';
    // 用户停止意图属终态，立即落盘
    this._flushToDisk();
    this._emit(id, 'task:stopping', { id });
  }

  deleteTask(id) {
    const task = this.tasks.get(id);
    if (task) {
      task.stopped = true;
      this.tasks.delete(id);
      // 删除是终态，立即原子落盘，避免崩溃后任务"复活"
      this._flushToDisk();
    }
  }

  getTask(id) {
    const task = this.tasks.get(id);
    return task ? this._serialize(task) : null;
  }

  getAllTasks() {
    return [...this.tasks.values()].map(t => this._serialize(t));
  }

  _resolveResumeStage(task) {
    if (task.products.fineFiltered.length > 0) return 'chatting';
    if (task.products.coarseFiltered.length > 0) return 'fine_filter';
    if (task.products.raw.length > 0) return 'coarse_filter';
    return null;
  }

  async _runPipeline(task, emitLog, shouldStop) {
    const resumeStage = this._resolveResumeStage(task);
    const stageOrder = ['login', 'searching', 'coarse_filter', 'fine_filter', 'chatting'];
    const resumeIdx = resumeStage ? stageOrder.indexOf(resumeStage) : -1;

    if (resumeStage) {
      emitLog(`♻️ 检测到历史数据，从「${resumeStage}」阶段恢复`);
      emitLog(`  已有: ${task.products.raw.length}采集 / ${task.products.coarseFiltered.length}粗筛 / ${task.products.fineFiltered.length}细筛 / ${(task.chatSessionsFull || []).length}聊天`);
    }

    // Stage 1: Login (always)
    task.stage = 'login';
    this._emitStage(task);
    emitLog('========== 阶段1: 登录验证 ==========');

    const loggedIn = await checkLogin(emitLog);
    if (!loggedIn || shouldStop()) return;

    const filterRequirements = this._buildFilterRequirements(task.config);

    // Stage 2: Search
    if (resumeIdx >= stageOrder.indexOf('searching')) {
      emitLog(`⏭️ 跳过搜索采集（已有 ${task.products.raw.length} 个商品）`);
    } else {
      task.stage = 'searching';
      this._emitStage(task);
      emitLog('========== 阶段2: 搜索采集 ==========');

      const filters = {
        priceMin: task.config.priceMin,
        priceMax: task.config.priceMax,
        region: task.config.region,
        personalSeller: task.config.personalSeller,
      };

      for (const query of task.config.queries) {
        if (shouldStop()) break;
        const products = await searchProducts(query, filters, task.config.maxPages, emitLog, shouldStop);
        const deduped = products.filter(p => !task.products.raw.some(e => e.id === p.id));
        task.products.raw.push(...deduped);
        this._emitProducts(task);
      }

      emitLog(`📊 总计采集 ${task.products.raw.length} 个商品（去重后）`);
      this._persistToDisk();
    }
    if (shouldStop() || task.products.raw.length === 0) return;

    // Stage 3: Coarse Filter
    if (resumeIdx >= stageOrder.indexOf('coarse_filter')) {
      emitLog(`⏭️ 跳过粗筛（已有 ${task.products.coarseFiltered.length} 个通过）`);
    } else {
      task.stage = 'coarse_filter';
      this._emitStage(task);
      emitLog('========== 阶段3: 粗筛（标题筛选） ==========');

      const coarseRequirements = this._buildCoarseRequirements(task.config);
      task.products.coarseFiltered = await coarseFilter(
        task.products.raw, coarseRequirements, emitLog, shouldStop, task.config.coarsePrompt
      );
      this._emitProducts(task);
      this._persistToDisk();
    }
    if (shouldStop() || task.products.coarseFiltered.length === 0) return;

    // Stage 4: Fine Filter
    if (resumeIdx >= stageOrder.indexOf('fine_filter')) {
      emitLog(`⏭️ 跳过细筛（已有 ${task.products.fineFiltered.length} 个通过）`);
    } else {
      task.stage = 'fine_filter';
      this._emitStage(task);
      emitLog('========== 阶段4: 细筛（详情页筛选） ==========');

      task.products.fineFiltered = await fineFilter(
        task.products.coarseFiltered, filterRequirements, emitLog, shouldStop, task.config.finePrompt
      );
      // 价格硬过滤兜底：UI 价格筛选可能静默失效，这里对明显越界的商品做程序化剔除
      task.products.fineFiltered = this._applyPriceGuard(task.products.fineFiltered, task.config, emitLog);
      this._emitProducts(task);
      this._persistToDisk();
    }
    if (shouldStop() || task.products.fineFiltered.length === 0) return;

    // Stage 5: Chat
    task.stage = 'chatting';
    this._emitStage(task);
    emitLog('========== 阶段5: 询价沟通 ==========');

    const chatManager = new ChatManager(emitLog, shouldStop);
    const chatContext = {
      requirements: filterRequirements,
      chatStrategy: task.config.chatStrategy,
      persona: task.config.persona,
    };

    const savedFull = task.chatSessionsFull || [];
    if (savedFull.length > 0) {
      const restored = chatManager.restoreSessions(savedFull, chatContext);
      if (restored > 0) {
        task.chatSessions = chatManager.getSessionsData();
        this._emit(task.id, 'task:chats', task.chatSessions);
      }
    }

    const chattedIds = new Set([...chatManager.sessions.keys()]);
    const newProducts = task.products.fineFiltered.filter(p => !chattedIds.has(p.id));

    if (newProducts.length > 0) {
      emitLog(`  ${newProducts.length} 个商品待发起聊天（跳过已有 ${chattedIds.size} 个）`);
    }

    // 有恢复会话时立即启动 WS 监控（边监听边补漏）
    let monitorPromise = null;
    if (chatManager.sessions.size > 0) {
      monitorPromise = chatManager.monitorSessions();
    }

    for (const product of newProducts) {
      if (shouldStop()) {
        emitLog(`  ⚠️ 任务已停止，跳过剩余 ${newProducts.length - newProducts.indexOf(product)} 个商品`);
        break;
      }
      await chatManager.startChat(product, chatContext);
      task.chatSessions = chatManager.getSessionsData();
      task.chatSessionsFull = chatManager.getSessionsFullData();
      this._emit(task.id, 'task:chats', task.chatSessions);

      // 第一个聊天发送完后，立即启动 WS 监控（并行运行）
      if (!monitorPromise) {
        monitorPromise = chatManager.monitorSessions();
      }

      const delay = CHAT_NEXT_PRODUCT_DELAY_BASE + Math.random() * CHAT_NEXT_PRODUCT_DELAY_RAND;
      emitLog(`  等待 ${Math.round(delay / 1000)}s 后处理下一个...`);
      await new Promise(r => setTimeout(r, delay));
    }

    // 无论是否被停止，先保存当前聊天数据（终态前立即落盘）
    task.chatSessions = chatManager.getSessionsData();
    task.chatSessionsFull = chatManager.getSessionsFullData();
    this._emit(task.id, 'task:chats', task.chatSessions);
    await this._flushToDisk();

    if (shouldStop()) {
      emitLog('⚠️ 任务已停止，跳过聊天监控（聊天数据已保存，可稍后恢复）');
      await chatManager.cleanup();
      return;
    }

    emitLog('开始持续监控聊天回复...');

    const chatBroadcastInterval = setInterval(() => {
      task.chatSessions = chatManager.getSessionsData();
      task.chatSessionsFull = chatManager.getSessionsFullData();
      this._emit(task.id, 'task:chats', task.chatSessions);
    }, CHAT_BROADCAST_INTERVAL_MS);

    const persistInterval = setInterval(() => {
      this._persistToDisk();
    }, PERSIST_INTERVAL_MS);

    try {
      // 如果监控已在并行运行，等待它结束；否则现在启动
      if (monitorPromise) {
        await monitorPromise;
      } else {
        await chatManager.monitorSessions();
      }
    } finally {
      clearInterval(chatBroadcastInterval);
      clearInterval(persistInterval);
    }

    task.chatSessions = chatManager.getSessionsData();
    task.chatSessionsFull = chatManager.getSessionsFullData();
    this._emit(task.id, 'task:chats', task.chatSessions);

    await chatManager.cleanup();
    await this._flushToDisk();
    emitLog('========== 任务流程结束 ==========');
  }

    /**
   * 价格硬过滤兜底。细筛对价格刻意宽松（偏高可砍价），因此这里只剔除"明显越界"：
   * - 低于 priceMin：通常是配件/错配商品（如笔记本搜到手机壳）
   * - 高于 priceMax 的 1.5 倍：商品档次明显不符，砍价也无意义
   * 价格无法解析的商品一律保留，不因缺数据而误杀。
   * 优先用详情页 detailPrice，回退列表 price。
   */
  _applyPriceGuard(products, config, emitLog) {
    const { priceMin, priceMax } = config;
    if (priceMin == null && priceMax == null) return products;

    const UPPER_MARGIN = 1.5;
    const kept = [];
    let dropped = 0;

    for (const p of products) {
      const price = parsePrice(p.detailPrice) ?? parsePrice(p.price);
      if (price == null) {
        kept.push(p); // 无价格信息，保留
        continue;
      }

      if (priceMin != null && price < priceMin) {
        dropped++;
        if (emitLog) emitLog(`    💰 价格兜底剔除: "${p.title?.slice(0, 24)}..." ¥${price} < 下限¥${priceMin}`);
        continue;
      }
      if (priceMax != null && price > priceMax * UPPER_MARGIN) {
        dropped++;
        if (emitLog) emitLog(`    💰 价格兜底剔除: "${p.title?.slice(0, 24)}..." ¥${price} > 上限¥${priceMax}×${UPPER_MARGIN}`);
        continue;
      }
      kept.push(p);
    }

    if (dropped > 0 && emitLog) {
      emitLog(`💰 价格硬过滤: 剔除 ${dropped} 个越界商品，保留 ${kept.length} 个`);
    }
    return kept;
  }

  _buildCoarseRequirements(config) {
    const parts = [];
    if (config.queries.length > 0) {
      parts.push(`目标商品: ${config.queries.join(', ')}`);
    }
    if (config.customRequirements) {
      parts.push(`补充需求: ${config.customRequirements}`);
    }
    return parts.join('\n');
  }

  _buildFilterRequirements(config) {
    const parts = [];
    if (config.queries.length > 0) {
      parts.push(`搜索关键词: ${config.queries.join(', ')}`);
    }
    if (config.priceMin != null || config.priceMax != null) {
      parts.push(`价格范围: ${config.priceMin ?? '不限'} - ${config.priceMax ?? '不限'}`);
    }
    if (config.region) {
      parts.push(`地区偏好: ${config.region}`);
    }
    if (config.personalSeller) {
      parts.push('只要个人卖家');
    }
    if (config.customRequirements) {
      parts.push(`商品需求: ${config.customRequirements}`);
    }
    return parts.join('\n');
  }

  _serialize(task) {
    return {
      id: task.id,
      name: task.name,
      config: task.config,
      stage: task.stage,
      running: task.running,
      stopped: task.stopped,
      products: {
        rawCount: task.products.raw.length,
        coarseCount: task.products.coarseFiltered.length,
        fineCount: task.products.fineFiltered.length,
        raw: task.products.raw.slice(0, 100),
        coarseFiltered: task.products.coarseFiltered.slice(0, 50),
        fineFiltered: task.products.fineFiltered,
      },
      chatSessions: task.chatSessions || [],
      logs: task.logs.slice(-200),
      createdAt: task.createdAt,
    };
  }

  _serializeFull(task) {
    return {
      id: task.id,
      name: task.name,
      config: task.config,
      stage: task.stage,
      products: {
        raw: task.products.raw,
        coarseFiltered: task.products.coarseFiltered,
        fineFiltered: task.products.fineFiltered,
      },
      chatSessions: task.chatSessions || [],
      chatSessionsFull: task.chatSessionsFull || [],
      logs: task.logs.slice(-500),
      createdAt: task.createdAt,
    };
  }

  /**
   * 请求持久化（节流 + 异步原子写）。
   * 短时间内多次调用会被合并，不阻塞事件循环。
   */
  _persistToDisk() {
    if (this._persistTimer) return; // 已有待写入，合并本次
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._flushToDisk().catch(err => {
        console.error('持久化任务失败:', err.message);
      });
    }, this._persistMinIntervalMs);
  }

  /**
   * 立即把当前所有任务原子写入磁盘。
   * 若已有写入在进行中，则标记一个待写入，等当前完成后补一次，
   * 保证最终落盘的是最新状态。返回 Promise 便于关键节点 await。
   */
  async _flushToDisk() {
    // 取消待触发的节流定时器（我们现在就写）
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }

    if (this._persistInFlight) {
      this._persistPendingWhileInFlight = true;
      return this._persistInFlight;
    }

    this._persistInFlight = this._doWrite()
      .catch(err => {
        console.error('持久化任务失败:', err.message);
      })
      .finally(async () => {
        this._persistInFlight = null;
        if (this._persistPendingWhileInFlight) {
          this._persistPendingWhileInFlight = false;
          await this._flushToDisk();
        }
      });

    return this._persistInFlight;
  }

  /**
   * 实际写盘：写临时文件后 rename 原子替换，避免半截 JSON 损坏数据。
   */
  async _doWrite() {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const data = [...this.tasks.values()].map(t => this._serializeFull(t));
    const json = JSON.stringify(data, null, 2);
    const tmpFile = `${TASKS_FILE}.${process.pid}.tmp`;
    await fsp.writeFile(tmpFile, json, 'utf-8');
    await fsp.rename(tmpFile, TASKS_FILE);
  }

  _loadFromDisk() {
    try {
      if (!fs.existsSync(TASKS_FILE)) return;
      const raw = fs.readFileSync(TASKS_FILE, 'utf-8');
      const data = JSON.parse(raw);
      for (const t of data) {
        let chatSessionsFull = t.chatSessionsFull || [];

        if (chatSessionsFull.length === 0 && (t.chatSessions || []).length > 0) {
          const fineMap = new Map((t.products?.fineFiltered || []).map(p => [p.id, p]));
          chatSessionsFull = t.chatSessions.map(s => {
            const product = fineMap.get(s.id) || {
              id: s.id,
              title: s.productTitle || '',
              price: s.productPrice || '',
              description: s.productDescription || '',
              sellerName: s.sellerName || '',
              chatUrl: '',
            };
            const messages = (s.messages || []).map(m => ({
              ...m,
              fingerprint: `${m.role}:${m.content?.trim()}`,
            }));
            const chatHistory = messages.map(m => ({
              role: m.role === 'self' ? 'assistant' : 'user',
              content: m.content,
            }));
            return {
              id: s.id,
              product,
              chatContext: null,
              status: s.status || 'waiting',
              goalReason: s.goalReason || '',
              messages,
              chatHistory,
              lastChecked: s.lastChecked || Date.now(),
              backoffLevel: 0,
            };
          });
          console.log(`  🔄 任务 ${t.id}: 从旧格式迁移了 ${chatSessionsFull.length} 个聊天会话`);
        }

        const task = {
          id: t.id,
          name: t.name,
          config: t.config,
          stage: (t.stage === 'completed' || t.stage === 'stopped') ? t.stage : 'stopped',
          running: false,
          stopped: true,
          products: {
            raw: t.products?.raw || [],
            coarseFiltered: t.products?.coarseFiltered || [],
            fineFiltered: t.products?.fineFiltered || [],
          },
          chatSessions: t.chatSessions || [],
          chatSessionsFull,
          logs: t.logs || [],
          createdAt: t.createdAt || Date.now(),
        };
        this.tasks.set(task.id, task);
      }
      console.log(`📂 从磁盘恢复了 ${data.length} 个任务`);
    } catch (err) {
      console.error('加载持久化任务失败:', err.message);
    }
  }

  _emit(taskId, event, data) {
    this.broadcast({ event, taskId, data });
  }

  _emitStage(task) {
    this._emit(task.id, 'task:stage', { id: task.id, stage: task.stage });
  }

  _emitProducts(task) {
    this._emit(task.id, 'task:products', {
      id: task.id,
      rawCount: task.products.raw.length,
      coarseCount: task.products.coarseFiltered.length,
      fineCount: task.products.fineFiltered.length,
    });
  }
}
