// 集中管理前端运行时状态。各模块通过导入的 getter/setter 读写，
// 避免散落的全局变量。

export const state = {
  tasks: [],
  activeTaskId: null,
  defaultPersona: '',
  defaultCoarsePrompt: '',
  defaultFinePrompt: '',
  providers: [],
  currentConfig: {},
  customModels: [],
  pendingStartTaskId: null,
};

// ---- 任务查找/更新辅助 ----

export function findTask(id) {
  return state.tasks.find(t => t.id === id);
}

export function upsertTask(task) {
  const idx = state.tasks.findIndex(t => t.id === task.id);
  if (idx >= 0) state.tasks[idx] = task;
  else state.tasks.push(task);
}

export function removeTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
}

export function updateTaskField(id, field, value) {
  const task = findTask(id);
  if (task) task[field] = value;
}