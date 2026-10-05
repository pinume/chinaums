(() => {
  const timestampFromFileName = (fileName, reportType, merchantNo) => {
    const escapedMerchantNo = merchantNo ? merchantNo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "[A-Z0-9]+";
    const pattern = reportType === "trade-audit"
      ? new RegExp(`^MER_${escapedMerchantNo}_(\\d{14})_yjhx\\.xlsx$`, "i")
      : new RegExp(`^${escapedMerchantNo}_MX_(\\d{14})(?:_[^.]*)?\\.xlsx$`, "i");
    const match = String(fileName || "").match(pattern);
    if (!match) return null;
    const stamp = match[1];
    const date = new Date(
      Number(stamp.slice(0, 4)),
      Number(stamp.slice(4, 6)) - 1,
      Number(stamp.slice(6, 8)),
      Number(stamp.slice(8, 10)),
      Number(stamp.slice(10, 12)),
      Number(stamp.slice(12, 14))
    );
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  };

  const timestampFromCreatedAt = (createdAt) => {
    const match = String(createdAt || "").match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (!match) return null;
    const date = new Date(
      Number(match[1]), Number(match[2]) - 1, Number(match[3]),
      Number(match[4]), Number(match[5]), Number(match[6])
    );
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  };

  const run = async ({
    invoke,
    reportType,
    merchantNo,
    onMerchantIdentified,
    startedAt,
    submittedMonths,
    gate,
    checkpoint,
    sleep,
    transition,
    now = () => Date.now()
  }) => {
    const expectedCount = submittedMonths.length;
    if (!expectedCount) return [];
    const requestedFiles = new Set(submittedMonths.map((month) => month.remoteFileName).filter(Boolean));
    if (requestedFiles.size !== submittedMonths.filter((month) => month.remoteFileName).length) {
      throw new Error("多个提交月份对应同一远端文件名，不能安全下载。");
    }
    if (requestedFiles.size !== expectedCount) throw new Error("缺少本月已确认的远端文件名，不能按提交时间猜测暂存任务。");
    const startedAtMs = reportType === "trade-audit" ? Math.floor(new Date(startedAt).getTime() / 1000) * 1000 : new Date(startedAt).getTime();
    if (Number.isNaN(startedAtMs)) throw new Error("本轮开始时间无效，不能筛选暂存任务。");

    await transition({ status: "OPENING_DOWNLOAD_LIST" });
    const opened = await invoke("openDownloadList", { gate, targetMerchantNo: merchantNo });
    if (!new Set(["clicked", "already_open"]).has(opened?.status)) {
      throw new Error(`无法安全打开下载暂存列表（${opened?.status || "无返回状态"}）：${opened?.reason || "页面操作未能确认"}；本轮已提交任务保留在远端。`);
    }

    const closeListAndWait = async () => {
      const closed = await invoke("closeDownloadList", {});
      if (!["closed", "already_closed"].includes(closed?.status)) {
        throw new Error("无法关闭暂存列表；已停止自动下载。");
      }
      const closeDeadline = now() + (reportType === "trade-audit" ? 30000 : 5000);
      let closeAttempts = 1;
      let lastCloseStatus = closed.status;
      let lastListStatus;
      let listClosed = closed.status === "already_closed";
      while (!listClosed) {
        await checkpoint();
        const list = await invoke("parseDownloadTasks", {});
        lastListStatus = list?.status || "unknown";
        if (["not_found", "not_open"].includes(list?.status)) { listClosed = true; break; }
        if (reportType === "trade-audit") {
          if (now() >= closeDeadline) break;
          await sleep(1000);
          if (now() >= closeDeadline) break;
          const retry = await invoke("closeDownloadList", {});
          closeAttempts += 1;
          lastCloseStatus = retry?.status || "unknown";
          if (lastCloseStatus === "already_closed") { listClosed = true; break; }
          if (lastCloseStatus !== "closed") break;
          continue;
        }
        if (now() >= closeDeadline) break;
        await sleep(200);
      }
      if (!listClosed) throw new Error(`暂存列表关闭结果无法确认（关闭返回 ${lastCloseStatus}，列表状态 ${lastListStatus}，尝试 ${closeAttempts} 次）；已停止自动下载。`);
    };

    let consecutiveParseErrors = 0;
    let lastList = null;
    let rejected = {};
    let cachedTotal = null;
    const taskPages = new Map();
    const parseTasks = async () => {
      const list = await invoke("parseDownloadTasks", {});
      lastList = list;
      if (list?.status === "parse_error") {
        consecutiveParseErrors += 1;
        if (consecutiveParseErrors >= 4) {
          throw new Error("下载暂存列表结构与已确认表头不符；为避免点错文件，自动下载已停止。");
        }
      } else {
        consecutiveParseErrors = 0;
      }
      return list;
    };

    const waitForDownloadList = async (required = true) => {
      const deadline = now() + 15000;
      while (now() < deadline) {
        await checkpoint();
        const list = await parseTasks();
        if (["found", "empty"].includes(list?.status)) return true;
        if (list?.status === "refresh_error") break;
        await sleep(200);
      }
      if (required) throw new Error(`暂存列表打开后未能读取（${lastList?.status || "unknown"}）；本轮已提交任务保留在远端。`);
      return false;
    };
    await waitForDownloadList();

    const scanCurrentRunTasks = async () => {
      rejected = { fileName: 0, createdAt: 0, beforeRun: 0 };
      if (reportType === "account-detail") {
        const pageSize = await invoke("setDownloadPageSize", {});
        if (pageSize?.status === "set") await sleep(500);
      }
      let list = await parseTasks();
      if (!["found", "empty"].includes(list?.status)) {
        return null;
      }
      let currentPage = Number(list.page) || 1;
      const pendingFiles = [...requestedFiles].filter((file) => !downloaded.has(file));
      const hintedPages = cachedTotal !== null && Number(list.total) === cachedTotal &&
        pendingFiles.every((file) => taskPages.has(file))
        ? [...new Set(pendingFiles.map((file) => taskPages.get(file)))].sort((a, b) => a - b) : null;
      const firstPage = hintedPages?.[0] ?? 1;
      if (currentPage !== firstPage) {
        const oldRows = JSON.stringify((list.rows || []).map((row) => row.fileName));
        const selected = await invoke("selectDownloadPage", { page: firstPage });
        if (selected?.status !== "clicked" && selected?.status !== "already_current") {
          if (hintedPages) { cachedTotal = null; return scanCurrentRunTasks(); }
          return null;
        }
        const deadline = now() + 15000;
        while (true) {
          await checkpoint();
          list = await parseTasks();
          if (["found", "empty"].includes(list?.status) && Number(list.page) === firstPage && JSON.stringify((list.rows || []).map((row) => row.fileName)) !== oldRows) break;
          if (now() >= deadline) break;
          await sleep(200);
        }
        if (Number(list?.page) !== firstPage || JSON.stringify((list.rows || []).map((row) => row.fileName)) === oldRows) {
          if (hintedPages) { cachedTotal = null; return scanCurrentRunTasks(); }
          return null;
        }
      }

      const collected = new Map();
      const duplicateCandidates = new Set();
      let complete = false;
      for (let pageAttempt = 0; pageAttempt < 100; pageAttempt += 1) {
        await checkpoint();
        list = await parseTasks();
        if (!["found", "empty"].includes(list?.status)) return null;
        currentPage = Number(list.page) || (pageAttempt + 1);

        for (const row of list.rows || []) {
          const fileTimestamp = timestampFromFileName(row.fileName, reportType, merchantNo);
          const createdTimestamp = timestampFromCreatedAt(row.createdAt);
          if (fileTimestamp === null) { rejected.fileName += 1; continue; }
          const task = { ...row, page: currentPage, fileTimestamp, createdTimestamp };
          if (requestedFiles.has(row.fileName)) {
            if (collected.has(row.fileName)) duplicateCandidates.add(row.fileName);
            else collected.set(row.fileName, task);
            continue;
          }
          rejected.beforeRun += 1;
        }

        if (duplicateCandidates.size) throw new Error("暂存列表中同名任务出现多次，无法唯一确认文件行；已暂停下载。");
        if (hintedPages && pageAttempt + 1 >= hintedPages.length) { complete = true; break; }
        if (!hintedPages && list.hasNext === false) { complete = true; break; }
        if (list.hasNext !== true) return null;

        const oldPage = currentPage;
        const oldRows = JSON.stringify((list.rows || []).map((row) => row.fileName));
        const targetPage = hintedPages?.[pageAttempt + 1];
        const next = await invoke(targetPage ? "selectDownloadPage" : "nextDownloadPage", targetPage ? { page: targetPage } : {});
        if (next?.status !== "clicked") {
          if (hintedPages) { cachedTotal = null; return scanCurrentRunTasks(); }
          return null;
        }
        const deadline = now() + 15000;
        let arrived = false;
        while (true) {
          await checkpoint();
          const after = await parseTasks();
          if (["found", "empty"].includes(after?.status) && Number(after.page) > oldPage && JSON.stringify((after.rows || []).map((row) => row.fileName)) !== oldRows) { arrived = true; break; }
          if (now() >= deadline) break;
          await sleep(200);
        }
        if (!arrived) {
          if (hintedPages) { cachedTotal = null; return scanCurrentRunTasks(); }
          return null;
        }
      }
      if (!complete) return null;
      if (hintedPages && pendingFiles.some((file) => !collected.has(file))) {
        cachedTotal = null;
        return scanCurrentRunTasks();
      }
      cachedTotal = list.total === null || list.total === undefined ? null : Number(list.total);
      for (const task of collected.values()) taskPages.set(task.fileName, task.page);
      const associated = [...collected.values()];
      return associated.sort((left, right) =>
        left.fileTimestamp - right.fileTimestamp || left.createdTimestamp - right.createdTimestamp
      );
    };

    const generationDeadline = startedAtMs + 6 * 24 * 60 * 60 * 1000;
    const orderedMonths = [...submittedMonths].sort((left, right) => left.submittedAt.localeCompare(right.submittedAt));
    const downloaded = new Set(submittedMonths.map((month) => month.downloadedFileName).filter(Boolean));
    let associatedTasks = [];
    let tasks = [];
    let generationWaitStartedAt = null;
    let scanFailures = 0;
    const associatedByFile = new Map();
    while (true) {
      await checkpoint();
      let scanned = null;
      try {
        scanned = await scanCurrentRunTasks();
      } catch (error) {
        if (error?.message === "STOPPED_BY_USER" || /同名任务|列表结构/.test(error?.message || "")) throw error;
        lastList = { status: "refresh_error", reason: error?.message || "列表读取失败" };
      }
      scanFailures = scanned === null ? scanFailures + 1 : 0;
      if (scanFailures >= 3) throw new Error(`暂存列表连续 3 次刷新读取失败（${lastList?.reason || lastList?.status || "unknown"}）；已提交任务保留，禁止重提。`);
      tasks = scanned || [];
      const failedTask = tasks.find((task) => !downloaded.has(task.fileName) && task.statusCode === "failed");
      if (failedTask) throw new Error(`文件 ${failedTask.fileName} 生成失败（${failedTask.status}）；停止等待，请核对服务器暂存任务。`);
      if (tasks.length > 0) {
        if (reportType === "trade-audit" && !merchantNo) {
          const merchants = [...new Set(tasks.map((task) => task.fileName.match(/^MER_([A-Z0-9]+)_/i)?.[1]?.toUpperCase()))];
          if (merchants.length !== 1 || !merchants[0]) throw new Error("本轮暂存任务包含多个商户或商户号无法确认，停止下载。");
          merchantNo = merchants[0];
          gate.allowed = true;
          gate.merchantNo = merchantNo;
          if (onMerchantIdentified) await onMerchantIdentified(merchantNo);
        }
        for (const task of tasks) associatedByFile.set(task.fileName, {
          ...task,
          month: task.month || orderedMonths.find((month) => month.remoteFileName === task.fileName)?.month || null,
          submitOrder: orderedMonths.findIndex((month) => month.remoteFileName === task.fileName) + 1
        });
        associatedTasks = [...associatedByFile.values()].sort((a, b) => a.submitOrder - b.submitOrder);

        for (const task of associatedTasks) {
          if (downloaded.has(task.fileName) || task.statusCode !== "ready" || task.downloadEnabled !== true) continue;
          await checkpoint();
          const currentList = await parseTasks();
          if (Number(currentList?.page) !== task.page) {
            const selected = await invoke("selectDownloadPage", { page: task.page });
            if (selected?.status !== "clicked" && selected?.status !== "already_current") {
              throw new Error(`无法回到暂存任务所在的第 ${task.page} 页；未点击该文件。`);
            }
            const deadline = now() + 15000;
            let arrived = false;
            while (true) {
              await checkpoint();
              const current = await parseTasks();
              if (current?.status === "found" && Number(current.page) === task.page && current.rows.some((row) => row.fileName === task.fileName)) { arrived = true; break; }
              if (now() >= deadline) break;
              await sleep(200);
            }
            if (!arrived) throw new Error("暂存列表翻页结果无法确认，停止下载。");
          }
          const requestedAt = new Date().toISOString();
          const requested = await invoke("downloadTask", { fileName: task.fileName, gate, targetMerchantNo: merchantNo });
          if (requested?.status !== "download_requested") {
            throw new Error(`任务 ${task.fileName} 未通过行内状态复核，停止后续下载。`);
          }
          await transition({ status: "DOWNLOAD_REQUESTED", fileName: task.fileName, month: task.month, submitOrder: task.submitOrder });
          const completed = await invoke("confirmDownload", { fileName: task.fileName, requestedAt });
          if (completed?.status !== "download_completed") throw new Error(`文件 ${task.fileName} 的下载完成状态无法确认；停止后续下载。`);
          downloaded.add(task.fileName);
          await transition({ status: "DOWNLOAD_COMPLETED", fileName: task.fileName, month: task.month, downloadId: completed.downloadId });
        }
      }
      if (downloaded.size === expectedCount) break;
      if (Date.now() >= generationDeadline) {
        throw new Error("本轮任务未能在暂存文件保留期限前全部生成；自动流程停止，请手动核对。 ");
      }
      const readyCount = tasks.filter((task) => !downloaded.has(task.fileName) && task.statusCode === "ready" && task.downloadEnabled === true).length;
      generationWaitStartedAt ??= now();
      await transition({ status: "WAITING_GENERATION", found: associatedByFile.size, ready: readyCount, expected: expectedCount,
        waitedMs: now() - generationWaitStartedAt, remaining: expectedCount - downloaded.size,
        listStatus: lastList?.status || "unknown", parsedRows: lastList?.rows?.length || 0, rejected });
      for (let second = 0; second < 10; second += 1) {
        await checkpoint();
        await sleep(1000);
      }
      await checkpoint();
      await closeListAndWait();
      let reopened;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          reopened = await invoke("openDownloadList", { gate, targetMerchantNo: merchantNo });
        } catch (error) {
          if (error?.message === "STOPPED_BY_USER") throw error;
          reopened = { status: "unknown", reason: error?.message };
        }
        if (reopened?.status === "clicked") break;
        if (!["controls_missing", "unknown"].includes(reopened?.status)) break;
        await checkpoint();
        await sleep(500);
      }
      if (reopened?.status !== "clicked") {
        throw new Error(`无法重新打开暂存列表以更新任务状态（${reopened?.status || "无返回状态"}）：${reopened?.reason || "页面操作未能确认"}；已停止自动下载。`);
      }
      while (!await waitForDownloadList(false)) {
        if (Date.now() >= generationDeadline) {
          throw new Error("本轮任务未能在暂存文件保留期限前全部生成；自动流程停止，请手动核对。 ");
        }
        if (lastList?.status === "refresh_error") {
          scanFailures += 1;
          if (scanFailures >= 3) {
            throw new Error(`暂存列表连续 3 次刷新读取失败（${lastList?.reason || lastList?.status || "unknown"}）；已提交任务保留，禁止重提。`);
          }
        }
        await transition({ status: "WAITING_GENERATION", found: associatedByFile.size, ready: readyCount, expected: expectedCount,
          waitedMs: now() - generationWaitStartedAt, remaining: expectedCount - downloaded.size,
          listStatus: lastList?.status || "unknown", parsedRows: lastList?.rows?.length || 0, rejected });
        for (let second = 0; second < 10; second += 1) {
          await checkpoint();
          await sleep(1000);
        }
      }
    }

    await transition({ status: "DOWNLOAD_REQUESTS_SENT", count: associatedTasks.length });
    await closeListAndWait();
    return associatedTasks;
  };

  globalThis.CHINAUMS_DOWNLOAD_RUNNER = Object.freeze({ run, timestampFromFileName });
})();

