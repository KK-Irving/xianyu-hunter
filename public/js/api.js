// 所有后端 API 调用集中在此。保持与原有端点完全一致。

async function parseJson(res) {
  return res.json();
}

/** 通用 POST，错误时抛出（调用方决定是否 alert） */
export async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  if (!res.ok && data.error) {
    const err = new Error(data.error);
    err.handled = false;
    throw err;
  }
  return data;
}

// ---- Providers / Config ----
export const getProviders = () => fetch('/api/providers').then(parseJson);
export const getConfig = () => fetch('/api/config').then(parseJson);
export const saveConfig = (body) => apiPost('/api/config', body);
export const testConfig = () => fetch('/api/config/test', { method: 'POST' }).then(parseJson);

// ---- Defaults / Model ----
export const getDefaults = () => fetch('/api/defaults').then(parseJson);
export const getModel = () => fetch('/api/model').then(parseJson);
export const setModel = (modelId) => apiPost('/api/model', { modelId });

// ---- Tasks ----
export const getTasks = () => fetch('/api/tasks').then(parseJson);
export const getTask = (id) => fetch(`/api/tasks/${id}`).then(parseJson);
export const createTask = (body) => apiPost('/api/tasks', body);
export const startTask = (id, body) => apiPost(`/api/tasks/${id}/start`, body);
export const stopTask = (id) => apiPost(`/api/tasks/${id}/stop`);
export const deleteTask = (id) => fetch(`/api/tasks/${id}`, { method: 'DELETE' }).then(parseJson);