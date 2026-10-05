(() => {
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
    if (requestedFiles.size !== expectedCount) {
      throw new Error("缺少本月已确认的远端文件名，不能按提交时间猜测暂存任务。");
    }
    const startedAtMs = reportType === "trade-audit"
      ? Math.floor(new Date(startedAt).getTime() / 1000) * 1000
      : new Date(startedAt).getTime();
    if (Number.isNaN(startedAtMs)) throw new Error("本轮开始时间无效，不能筛选暂存任务。");
    const generationDeadline = startedAtMs + 6 * 24 * 60 * 60 * 1000;
    const expectedTasks = new Map(submittedMonths.map((month) => [String(month.remoteTaskId || ""), month]));
    if (expectedTasks.has("") || expectedTasks.size !== expectedCount) {
      throw new Error("缺少本轮已确认的暂存任务 ID，不能安全等待生成。");
    }

    const reportLabel = reportType === "trade-audit" ? "以旧换新" : "对账明细";
    const generationWaitStartedAt = now();
    let consecutiveApiErrors = 0;
    let readyApiTasks = [];
    while (true) {
      await checkpoint();
      if (Date.now() >= generationDeadline) {
        throw new Error("本轮任务未能在暂存文件保留期限前全部生成；自动流程停止，请手动核对。");
      }
      let snapshot;
      try {
        snapshot = await invoke("snapshotExportTasks", { taskIds: [...expectedTasks.keys()] });
      } catch (error) {
        if (error?.message === "STOPPED_BY_USER") throw error;
        snapshot = { status: "error", reason: error?.message || "接口读取失败" };
      }
      if (snapshot?.status !== "found" || !Array.isArray(snapshot.rows)) {
        consecutiveApiErrors += 1;
        if (consecutiveApiErrors >= 3) {
          throw new Error(`${reportLabel}暂存接口连续 3 次读取失败（${snapshot?.reason || snapshot?.status || "unknown"}）；已提交任务保留，禁止重提。`);
        }
        await transition({
          status: "WAITING_GENERATION",
          found: 0,
          ready: 0,
          expected: expectedCount,
          waitedMs: now() - generationWaitStartedAt,
          remaining: expectedCount,
          listStatus: snapshot?.status || "api_error",
          parsedRows: 0
        });
      } else {
        consecutiveApiErrors = 0;
        const byId = new Map(snapshot.rows.map((row) => [String(row.id || ""), row]));
        for (const row of snapshot.rows) {
          const expected = submittedMonths.find((month) => month.remoteFileName === row.fileName);
          if (expected && String(expected.remoteTaskId) !== String(row.id)) {
            throw new Error(`暂存接口中的文件 ${row.fileName} 对应了非本轮任务 ID；停止下载。`);
          }
        }
        const matched = [];
        for (const [taskId, month] of expectedTasks) {
          const row = byId.get(taskId);
          if (!row) continue;
          if (row.fileName !== month.remoteFileName) {
            throw new Error(`暂存任务 ${taskId} 的文件名与本轮记录不一致；停止下载。`);
          }
          matched.push(row);
        }
        const failedTask = matched.find((row) => row.statusCode === "failed");
        if (failedTask) {
          throw new Error(`文件 ${failedTask.fileName} 生成失败（${failedTask.errorMsg || failedTask.exportStatusDesc || failedTask.exportStatus || "服务器返回失败状态"}）；停止等待，请核对服务器暂存任务。`);
        }
        const readyCount = matched.filter((row) => row.statusCode === "ready").length;
        if (matched.length === expectedCount && readyCount === expectedCount) {
          readyApiTasks = matched;
          break;
        }
        await transition({
          status: "WAITING_GENERATION",
          found: matched.length,
          ready: readyCount,
          expected: expectedCount,
          waitedMs: now() - generationWaitStartedAt,
          remaining: expectedCount - readyCount,
          listStatus: "api",
          parsedRows: snapshot.rows.length
        });
      }
      for (let second = 0; second < 10; second += 1) {
        await checkpoint();
        await sleep(1000);
      }
    }

    if (reportType === "trade-audit" && !merchantNo) {
      const merchants = [...new Set(readyApiTasks
        .map((task) => String(task.fileName || "").match(/^MER_([A-Z0-9]+)_/i)?.[1]?.toUpperCase())
        .filter(Boolean))];
      if (merchants.length !== 1) {
        throw new Error("本轮暂存任务包含多个商户或商户号无法确认，停止下载。");
      }
      merchantNo = merchants[0];
      gate.allowed = true;
      gate.merchantNo = merchantNo;
      if (onMerchantIdentified) await onMerchantIdentified(merchantNo);
    }

    const readyById = new Map(readyApiTasks.map((row) => [String(row.id || ""), row]));
    const orderedMonths = [...submittedMonths].sort((left, right) => left.submittedAt.localeCompare(right.submittedAt));
    const downloaded = new Set(submittedMonths.map((month) => month.downloadedFileName)
      .filter((fileName) => requestedFiles.has(fileName)));
    const associatedTasks = orderedMonths.map((month, index) => ({
      ...readyById.get(String(month.remoteTaskId || "")),
      month: month.month || null,
      submitOrder: index + 1
    }));

    for (const task of associatedTasks) {
      if (downloaded.has(task.fileName)) continue;
      await checkpoint();
      const requestedAt = new Date().toISOString();
      const requested = await invoke("downloadTaskDirect", {
        taskId: task.id,
        fileName: task.fileName,
        gate,
        targetMerchantNo: merchantNo
      });
      if (requested?.status !== "download_requested") {
        throw new Error(`任务 ${task.fileName} 未通过直接下载门禁（${requested?.reason || requested?.status || "unknown"}）；停止后续下载。`);
      }
      await transition({
        status: "DOWNLOAD_REQUESTED",
        fileName: task.fileName,
        month: task.month,
        submitOrder: task.submitOrder
      });
      const completed = await invoke("confirmDownload", { fileName: task.fileName, requestedAt });
      if (completed?.status !== "download_completed") {
        throw new Error(`文件 ${task.fileName} 的下载完成状态无法确认；停止后续下载。`);
      }
      downloaded.add(task.fileName);
      await transition({
        status: "DOWNLOAD_COMPLETED",
        fileName: task.fileName,
        month: task.month,
        downloadId: completed.downloadId
      });
    }

    if ([...requestedFiles].some((fileName) => !downloaded.has(fileName))) {
      throw new Error(`${reportLabel}直接下载未覆盖全部本轮任务；已停止后续操作。`);
    }
    await transition({ status: "DOWNLOAD_REQUESTS_SENT", count: associatedTasks.length });
    return associatedTasks;
  };

  globalThis.CHINAUMS_DOWNLOAD_RUNNER = Object.freeze({ run });
})();
