(() => {
  const monthKey = (year, month) => `${year}-${String(month).padStart(2, "0")}`;
  const formatDate = (year, month, day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

  const makeMonthRange = (year, month, today = new Date()) => {
    const lastDay = daysInMonth(year, month);
    const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
    return {
      key: monthKey(year, month),
      start: formatDate(year, month, 1),
      end: formatDate(year, month, isCurrentMonth ? Math.min(lastDay, today.getDate()) : lastDay)
    };
  };

  const yearToDateMonths = (today = new Date()) => Array.from(
    { length: today.getMonth() + 1 },
    (_, index) => makeMonthRange(today.getFullYear(), index + 1, today)
  );

  const run = async ({ months, reportType, invoke, gate, targetMerchantNo, checkpoint, sleep, transition, reconcileUnknown, onMerchantVerified }) => {
    if (!Array.isArray(months) || !months.length) throw new Error("没有可执行的月份。");
    const results = [];
    let throttleAttempts = 0;
    let activeMerchantId = null;
    let activeMerchantNo = String(targetMerchantNo || gate?.merchantNo || "").replace(/[\s\u200B-\u200D\uFEFF]/g, "").toUpperCase();

    const setMonthState = async (month, status, extra = {}) => {
      const result = { month: month.key, status, ...extra };
      results.push(result);
      await transition(result);
      return result;
    };

    const waitForDialogClear = async () => {
      if (!["account-detail", "trade-audit"].includes(reportType)) return;
      const deadline = Date.now() + 10000;
      let clearSince = null;
      while (Date.now() < deadline) {
        await checkpoint();
        const result = await invoke("submitDialogState", {});
        if (result?.status === "clear") {
          clearSince ??= Date.now();
          if (Date.now() - clearSince >= 1000) return;
        } else if (result?.status === "visible") {
          clearSince = null;
        } else {
          throw new Error("弹窗状态无法确认，未继续页面操作。");
        }
        await sleep(250);
      }
      throw new Error("弹窗未连续消失并稳定1秒，未继续下个月或申请导出；已受理任务禁止重提。");
    };

    for (const month of months) {
      await checkpoint();
      await waitForDialogClear();
      await transition({ month: month.key, status: "SETTING_DATE" });
      const setDate = await invoke("setDateRange", { start: month.start, end: month.end });
      if (setDate?.status !== "set") {
        await setMonthState(month, "FAILED", { reason: setDate?.reason || "无法确认日期范围。" });
        throw new Error(`${month.key} 日期设置失败：${setDate?.reason || "状态未确认"}`);
      }

      await transition({ month: month.key, status: "STARTING_QUERY" });
      let query;
      try {
        query = await invoke("query", {});
      } catch (error) {
        if (error?.message === "STOPPED_BY_USER") throw error;
        const reason = `查询调用失败或超时：${error?.message || "页面未响应"}`;
        await setMonthState(month, "FAILED", { reason });
        throw new Error(`${month.key} 查询调用未能确认：${error?.message || "页面未响应"}`);
      }
      if (query?.status !== "clicked") {
        await setMonthState(month, "FAILED", { reason: query?.reason || "查询按钮状态未确认。" });
        throw new Error(`${month.key} 查询未能安全启动。`);
      }
      await transition({ month: month.key, status: "QUERYING" });

      const queryDeadline = Date.now() + 120000;
      let queryState = { status: "waiting" };
      while (Date.now() < queryDeadline) {
        await checkpoint();
        queryState = await invoke("queryState", { targetMerchantNo: activeMerchantNo || null, targetMerchantId: activeMerchantId });
        if (queryState?.status === "failed") {
          await setMonthState(month, "FAILED", { reason: queryState.reason || "查询过程出现无法确认的状态。" });
          throw new Error(`${month.key} 查询状态异常：${queryState.reason || "已停止"}`);
        }
        if (["ready", "no_data"].includes(queryState?.status)) break;
        await sleep(1000);
      }
      if (!["ready", "no_data"].includes(queryState?.status)) {
        await setMonthState(month, "FAILED", { reason: "两分钟内没有取得明确的查询完成状态；查询没有触发导出申请。" });
        throw new Error(`${month.key} 查询结果状态无法确认；为防止错月导出，已暂停。`);
      }
      if (queryState.status === "ready") {
        const actualMerchantNo = String(queryState.merchantNo || "").replace(/\s/g, "").toUpperCase();
        const actualMerchantId = String(queryState.merchantId || "").trim();
        if (!actualMerchantNo && !actualMerchantId) {
          await setMonthState(month, "FAILED", { reason: "查询结果中没有唯一可确认的商户号；未申请导出。" });
          throw new Error(`${month.key} 查询结果中没有唯一可确认的商户号；未申请导出。`);
        }
        if (activeMerchantNo && actualMerchantNo && actualMerchantNo !== activeMerchantNo) {
          await setMonthState(month, "FAILED", { reason: `查询结果商户号 ${actualMerchantNo} 与本轮已确认商户号 ${activeMerchantNo} 不一致；未申请导出。` });
          throw new Error(`${month.key} 查询结果商户号与本轮已确认商户号不一致；未申请导出。`);
        }
        if (activeMerchantId && actualMerchantId !== activeMerchantId) {
          await setMonthState(month, "FAILED", { reason: "查询结果的内部商户 ID 已切换；未申请导出。" });
          throw new Error(`${month.key} 商户身份已切换；未申请导出。`);
        }
        activeMerchantId = actualMerchantId || activeMerchantId;
        activeMerchantNo = actualMerchantNo || activeMerchantNo;
        try {
          if (onMerchantVerified && activeMerchantNo) await onMerchantVerified(activeMerchantNo);
        } catch (error) {
          await setMonthState(month, "FAILED", { reason: error?.message || "查询结果商户号核对未通过；未申请导出。" });
          throw error;
        }
        gate.allowed = true;
        gate.merchantNo = activeMerchantNo;
        gate.merchantId = activeMerchantId;
        gate.source = "query-result";
        await transition({ month: month.key, status: "QUERY_READY", count: queryState.count, merchantNo: activeMerchantNo });
      }
      if (queryState.status === "no_data") {
        await setMonthState(month, "NO_DATA", { count: 0 });
        throttleAttempts = 0;
        continue;
      }

      let submitted = false;
      while (!submitted) {
        await checkpoint();
        await waitForDialogClear();
        const baseline = await invoke("snapshotExportTasks", {});
        if (baseline?.status !== "found" || !Array.isArray(baseline.rows)) throw new Error(`${month.key} 无法读取申请前暂存任务；未申请导出。`);
        const previousIds = new Set(baseline.rows.map((row) => row.id));
        const attemptedAt = new Date().toISOString();
        await transition({ month: month.key, status: "SUBMITTING", attemptedAt });
        let submit;
        try {
          submit = await invoke("submitExport", { gate, targetMerchantNo: activeMerchantNo, targetMerchantId: activeMerchantId });
        } catch (error) {
          if (error?.message === "STOPPED_BY_USER") throw error;
          submit = { status: "unknown", reason: error?.message || "提交调用未响应" };
        }
        if (["blocked", "wrong_page", "controls_missing"].includes(submit?.status)) {
          await setMonthState(month, "FAILED", { reason: submit?.reason || "导出控件未通过门禁检查。" });
          throw new Error(`${month.key} 导出已锁定：${submit?.reason || "控件状态未确认"}`);
        }

        const responseDeadline = Date.now() + 12000;
        let response = { status: "unknown" };
        while (submit?.status === "clicked" && Date.now() < responseDeadline) {
          await checkpoint();
          try {
            response = await invoke("classifySubmit", {});
          } catch (error) {
            if (error?.message === "STOPPED_BY_USER") throw error;
            response = { status: "unknown", reason: error?.message || "提交结果未响应" };
            break;
          }
          if (response?.status !== "unknown") break;
          await sleep(500);
        }

        if (response?.status === "accepted") {
          const accepted = await setMonthState(month, "SUBMITTED", { submittedAt: attemptedAt, remoteFileName: response.fileName || null, count: queryState.count });
          throttleAttempts = 0;
          submitted = true;
          let closed = { status: "unknown" };
          for (let closeAttempt = 0; closeAttempt < 3; closeAttempt += 1) {
            try {
              closed = await invoke("closeSubmitDialog", {});
            } catch (error) {
              if (error?.message === "STOPPED_BY_USER") throw error;
              throw new Error(`${month.key} 已确认服务器接受申请；本月已记为已提交，关闭提示操作未完成（${error?.message || "页面未响应"}）；禁止重提。`);
            }
            if (closed?.status === "closed") break;
            await sleep(350);
          }
          if (closed?.status !== "closed") {
            throw new Error(`${month.key} 已确认服务器接受申请；本月已记为已提交，提示框关闭失败（${closed?.reason || closed?.status || "未知状态"}）。`);
          }
          await waitForDialogClear();
          const deadline = Date.now() + 15000;
          let task = null;
          let snapshotReason = "";
          while (Date.now() < deadline) {
            await checkpoint();
            let snapshot;
            try {
              snapshot = await invoke("snapshotExportTasks", { operationDeadline: deadline });
            } catch (error) {
              if (error?.message === "STOPPED_BY_USER") throw error;
              snapshotReason = error?.message || "暂存读取未响应";
              await sleep(Math.max(0, Math.min(500, deadline - Date.now())));
              continue;
            }
            if (Date.now() >= deadline) break;
            if (snapshot?.status !== "found" || !Array.isArray(snapshot.rows)) {
              snapshotReason = snapshot?.reason || snapshot?.status || "暂存读取无返回结果";
              if (!["unknown", "loading", "empty"].includes(snapshot?.status)) {
                throw new Error(`${month.key} 已提交，但无法核对新建暂存任务（${snapshotReason}）；禁止重提。`);
              }
              await sleep(Math.max(0, Math.min(500, deadline - Date.now())));
              continue;
            }
            snapshotReason = "";
            const added = snapshot.rows.filter((row) => !previousIds.has(row.id));
            if (added.length > 1) throw new Error(`${month.key} 已提交，但出现多个新暂存任务，无法唯一确认归属；禁止重提。`);
            if (added.length === 1) { task = added[0]; break; }
            await sleep(Math.max(0, Math.min(500, deadline - Date.now())));
          }
          if (!task) throw new Error(`${month.key} 已提交，但15秒内未确认新建暂存任务${snapshotReason ? `（${snapshotReason}）` : ""}；禁止重提。`);
          const match = task?.fileName?.match(activeMerchantId
            ? /^MER_([A-Z0-9]+)_\d{14}_yjhx\.xlsx$/i
            : /^([A-Z0-9]+)_MX_\d{14}(?:_[^.]*)?\.xlsx$/i);
          if (!match || (activeMerchantNo && match[1].toUpperCase() !== activeMerchantNo) ||
            (response.fileName && response.fileName !== task.fileName) || baseline.rows.some((row) => row.fileName === task?.fileName)) {
            throw new Error(`${month.key} 已提交，但新任务文件名或商户号无法确认；禁止重提。`);
          }
          activeMerchantNo = match[1].toUpperCase();
          gate.merchantNo = activeMerchantNo;
          Object.assign(accepted, { remoteFileName: task.fileName, remoteTaskId: task.id });
          await transition(accepted);
          if (onMerchantVerified) await onMerchantVerified(activeMerchantNo, "download-task");
          continue;
        }

        if (response?.status === "throttled") {
          const closed = await invoke("closeSubmitDialog", {});
          if (closed?.status !== "closed") {
            await setMonthState(month, "UNKNOWN", { reason: "识别到限流，但提示无法安全关闭。" });
            throw new Error(`${month.key} 限流提示未能安全关闭，已暂停。`);
          }
          throttleAttempts += 1;
          const waitMs = Math.min(30000 * 2 ** (throttleAttempts - 1), 120000);
          await transition({ month: month.key, status: "WAITING_FOR_SLOT", retryInMs: waitMs, attempt: throttleAttempts });
          const end = Date.now() + waitMs;
          if (reportType === "account-detail") {
            const files = new Set(results.filter((item) => item.status === "SUBMITTED")
              .map((item) => item.remoteFileName).filter(Boolean));
            let baselinePending = null;
            let slotReleased = false;
            let listOpened = false;
            const closeSlotList = async () => {
              const closedList = await invoke("closeDownloadList", {});
              if (!["closed", "already_closed"].includes(closedList?.status)) throw new Error("限流等待期间暂存列表无法关闭。");
              const deadline = Date.now() + 5000;
              while (Date.now() < deadline) {
                await checkpoint();
                if (["not_found", "not_open"].includes((await invoke("parseDownloadTasks", {}))?.status)) { listOpened = false; return; }
                await sleep(200);
              }
              throw new Error("限流等待期间暂存列表关闭结果无法确认。");
            };
            try {
              while (files.size && Date.now() < end) {
                await checkpoint();
                const opened = await invoke("openDownloadList", {});
                if (!["clicked", "already_open"].includes(opened?.status)) break;
                listOpened = true;
                const readDeadline = Math.min(end, Date.now() + 15000);
                let list;
                do {
                  await checkpoint();
                  list = await invoke("parseDownloadTasks", {});
                  if (["found", "empty", "refresh_error"].includes(list?.status)) break;
                  await sleep(200);
                } while (Date.now() < readDeadline);
                if (list?.status !== "found") break;
                const pageSize = await invoke("setDownloadPageSize", {});
                if (pageSize?.status === "set") {
                  do {
                    await checkpoint();
                    list = await invoke("parseDownloadTasks", {});
                    if (["found", "empty", "refresh_error"].includes(list?.status)) break;
                    await sleep(200);
                  } while (Date.now() < readDeadline);
                }
                const rows = list?.rows?.filter((row) => files.has(row.fileName)) || [];
                if (list?.status !== "found" || rows.length !== files.size || new Set(rows.map((row) => row.fileName)).size !== files.size || rows.some((row) => !["pending", "ready"].includes(row.statusCode))) break;
                const pending = rows.filter((row) => row.statusCode === "pending").length;
                await transition({ month: month.key, status: "WAITING_FOR_SLOT", retryInMs: Math.max(0, end - Date.now()), attempt: throttleAttempts, pending, generated: rows.length - pending });
                await closeSlotList();
                if (baselinePending !== null && pending < baselinePending) { slotReleased = true; break; }
                if (pending === 0) break;
                baselinePending = pending;
                await sleep(Math.min(10000, Math.max(0, end - Date.now())));
              }
            } catch (error) {
              if (error?.message === "STOPPED_BY_USER") throw error;
              // 读取失败时保留原有退避，不推断任务已受理或重新提交旧月份。
            } finally {
              if (listOpened) {
                await closeSlotList();
              }
            }
            if (slotReleased || Date.now() >= end) {
              // 名额释放或等待窗口结束后，服务器仍是是否允许申请的最终判断。
              continue;
            }
          }
          while (Date.now() < end) {
            await checkpoint();
            await sleep(Math.min(1000, end - Date.now()));
          }
          continue;
        }

        if (response?.status === "failed") {
          const closed = await invoke("closeSubmitDialog", {});
          await setMonthState(month, "FAILED", { reason: response.message || "服务器明确拒绝了申请。" });
          if (closed?.status !== "closed") await transition({ month: month.key, status: "FAILED_DIALOG_REMAINS" });
          throw new Error(`${month.key} 导出失败：${response.message || "服务器返回明确失败"}`);
        }

        await transition({ month: month.key, status: "UNKNOWN", attemptedAt });
        let reconciliation = { status: "unknown" };
        try {
          if (reconcileUnknown) reconciliation = await reconcileUnknown({ month, attemptedAt, gate, targetMerchantNo: activeMerchantNo });
        } catch (error) {
          if (error?.message === "STOPPED_BY_USER") throw error;
          reconciliation.reason = error?.message || "未知申请对账失败";
        }
        if (reconciliation?.status === "accepted") {
          await setMonthState(month, "SUBMITTED", {
            submittedAt: attemptedAt,
            remoteCreatedAt: reconciliation.createdAt || null,
            reconciled: true,
            remoteFileName: reconciliation.fileName || null,
            count: queryState.count
          });
          submitted = true;
          throttleAttempts = 0;
          continue;
        }
        await setMonthState(month, "UNKNOWN", { attemptedAt, reason: reconciliation?.reason || "服务端是否接受申请无法确认，禁止自动重提。" });
        throw new Error(`${month.key} 提交结果 UNKNOWN；先核对暂存列表，不会自动重试。`);
      }
    }

    return results;
  };

  globalThis.CHINAUMS_MONTHLY_RUNNER = Object.freeze({
    makeMonthRange,
    yearToDateMonths,
    run
  });
})();

