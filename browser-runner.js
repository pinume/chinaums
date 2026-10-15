(() => {
  const create = ({ chrome, host, tabId, checkpoint, sleep, now }) => {
    const withTimeout = (promise, milliseconds, operation) => {
      let timerId;
      const timeout = new Promise((_, reject) => {
        timerId = window.setTimeout(
          () => reject(new Error(`接口操作“${operation}”在${Math.ceil(milliseconds / 1000)}秒内没有响应。`)),
          milliseconds
        );
      });
      return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timerId));
    };
    const waitForDownload = async ({ fileName, downloadId }) => {
      if (!chrome.downloads?.search) throw new Error("下载确认权限不可用，请重新加载扩展并允许 downloads 权限。");
      if (!Number.isInteger(downloadId) || downloadId < 0) throw new Error("下载 ID 无效，不能确认下载完成。");
      const escapedStem = fileName.replace(/\.xlsx$/i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const filenameRegex = `(?:^|[/\\\\])${escapedStem}(?: \\(\\d+\\))?\\.xlsx$`;
      const deadline = now() + 5 * 60 * 1000;
      while (now() < deadline) {
        await checkpoint();
        const items = await chrome.downloads.search({ id: downloadId });
        if (items.length > 1) throw new Error(`文件 ${fileName} 对应多个新下载记录，无法唯一确认。`);
        const item = items[0];
        if (item && item.id !== downloadId) throw new Error(`文件 ${fileName} 的下载记录身份不一致。`);
        if (item?.state === "interrupted") throw new Error(`文件 ${fileName} 下载中断：${item.error || "未知原因"}。`);
        if (item?.state === "complete") {
          if (!new RegExp(filenameRegex, "i").test(item.filename || "")) throw new Error(`文件 ${fileName} 的下载记录身份不一致。`);
          if (item.exists !== true) throw new Error(`文件 ${fileName} 已被删除，不能记为下载完成。`);
          return { status: "download_completed", downloadId: item.id };
        }
        await sleep(500);
      }
      throw new Error(`文件 ${fileName} 在 5 分钟内未确认下载完成；停止后续下载，请检查 Chrome 下载记录。`);
    };

    const injectedAdapters = new Set();
    const invoke = async (reportType, operation, args = {}) => {
      await checkpoint();
      if (operation === "confirmDownload") return waitForDownload(args);
      const defaultLimit = ["account-detail", "trade-audit"].includes(reportType) && ["query", "submitExport"].includes(operation) ? 60000 : 15000;
      const operationDeadline = Math.min(Date.now() + defaultLimit, args.operationDeadline ?? Infinity);
      const checkDeadline = () => {
        if (Date.now() >= operationDeadline) throw new Error(`接口操作“${operation}”已超过截止时间。`);
      };
      checkDeadline();
      return withTimeout((async () => {
        const frameId = 0;
        checkDeadline();
        const file = reportType === "account-detail" ? "account-detail.js" : "trade-audit.js";
        const globalName = reportType === "account-detail"
          ? "__chinaumsAccountDetailAdapter"
          : "__chinaumsTradeAuditAdapter";
        const world = "ISOLATED";
        const loaded = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frameId] }, world,
          func: (name) => typeof globalThis[name] === "function",
          args: [globalName]
        });
        checkDeadline();
        const injectionKey = `${tabId}:${frameId}:${file}`;
        if (!injectedAdapters.has(injectionKey) || loaded[0]?.result !== true) {
          await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world, files: [file] });
          injectedAdapters.add(injectionKey);
        }
        checkDeadline();
        const result = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frameId] }, world,
          func: async (name, action, actionArgs) => {
            if (Date.now() >= actionArgs.operationDeadline) throw new Error("接口操作已超过截止时间，未执行。");
            const adapter = globalThis[name];
            if (typeof adapter !== "function") return { status: "adapter_missing" };
            return await adapter(action, actionArgs);
          },
          args: [globalName, operation, { ...args, operationDeadline }]
        });
        const response = result[0]?.result || { status: "unknown" };
        if (operation !== "downloadTaskDirect" || response.status !== "download_requested") return response;
        const url = new URL(response.url);
        const account = reportType === "account-detail";
        const expectedPath = account ? "/uisportal/commonController/exportDeailBill"
          : `/uisportal/api/uis-tradein-server/portal/yjhx/v3/downloadExportFile/${args.taskId}`;
        if (url.origin !== `https://${host}` || url.pathname !== expectedPath ||
          (account && url.searchParams.get("exportId") !== args.taskId) ||
          (!account && !url.searchParams.get("userPortalToken"))) throw new Error("下载地址与本轮任务不一致。");
        await checkpoint();
        checkDeadline();
        const downloadId = await chrome.downloads.download({ url: url.href, conflictAction: "uniquify" });
        if (!Number.isInteger(downloadId) || downloadId < 0) throw new Error("Chrome 未返回有效下载 ID；禁止重复请求。");
        return { status: "download_requested", downloadId };
      })(), Math.max(0, operationDeadline - Date.now()), operation);
    };

    return invoke;
  };
  globalThis.CHINAUMS_BROWSER_RUNNER = Object.freeze({ create });
})();
