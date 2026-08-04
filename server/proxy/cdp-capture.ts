// P-3：CDP 仅对标准 Electron 应用有效（G6.5：对 Trae 无效），且只在 dev 模式暴露。
// 生成但不端到端验证。

export interface CdpTarget {
  id: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

/** REQ-012：发现 Electron targets（默认 9222）。 */
export async function discoverCdpTargets(port = 9222): Promise<CdpTarget[]> {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  if (!res.ok) {
    return [];
  }
  const body = (await res.json()) as CdpTarget[];
  return body.filter((t) => t.webSocketDebuggerUrl !== undefined);
}

/** REQ-012：连接 target，loadingFinished 时取 response body（骨架）。 */
export async function connectCdpCapture(
  target: CdpTarget,
  onCapture: (entry: { url: string; body: string }) => void,
): Promise<() => void> {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let requestId = 0;
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('CDP connect failed'));
  });
  ws.send(JSON.stringify({ id: 1, method: 'Network.enable' }));
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data)) as {
      method?: string;
      params?: { requestId?: string; response?: { url?: string } };
    };
    if (msg.method === 'Network.loadingFinished' && msg.params?.requestId !== undefined) {
      const id = ++requestId;
      ws.send(JSON.stringify({ id, method: 'Network.getResponseBody', params: { requestId: msg.params.requestId } }));
    }
    if (msg.method === undefined && msg.params?.response?.url !== undefined) {
      // 骨架：真实环境下按 response body 事件解析
      onCapture({ url: msg.params.response.url, body: '' });
    }
  };
  return () => ws.close();
}
