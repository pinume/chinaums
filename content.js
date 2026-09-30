(() => {
  let SITE_CONFIG = null;
  let TARGET_HOST = null;
  let MAIN_NAV_ROUTES = new Map();
  const BUSINESS_ENTRY_ROUTES = [
    { text: "新增员工", pattern: /^user\/newUser(?:[?#]|$)/i },
    { text: "商户信息", pattern: /^merInfoUser\/businessCenter(?:[?#]|$)/i },
    { text: "员工管理", pattern: /^merInfoUser\/myStaff(?:[?#]|$)/i },
    { text: "实时交易查询", pattern: /^qryCRealTimeTrans\/toCRealTimeTrans(?:[?#]|$)/i },
    { text: "对账明细查询", pattern: /^accountCheckDetailQry\/toDetail(?:[?#]|$)/i },
    { text: "POS业务申办", pattern: /^business\/businessBidding(?:[?#]|$)/i }
  ];
  const NOISE_CLASSES = [
    "swiper-pagination",
    "swiper-pagination-bullet",
    "slick-dot",
    "slick-dots",
    "carousel-indicator",
    "carousel-control"
  ];

  const cleanText = (value, limit = 240) =>
    String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);

  const sanitizeScriptHref = (rawHref) => String(rawHref || "").replace(
    /([?&](?:token|ticket|secret|password|session|auth|code|merchantId|merId)=)[^&'"\s)]+/gi,
    "$1[已隐藏]"
  );

  const describeHandler = (rawHandler) => {
    if (!rawHandler) return "";
    const handler = String(rawHandler);
    const call = handler.match(/(?:^|[;{}\s])([\w$]+(?:\.[\w$]+)*)\s*\(/);
    return call ? `${call[1]}(…)` : "已设置（代码未采集）";
  };

  const dedupeBy = (items, keyOf) => {
    const seen = new Set();
    return items.filter((item) => {
      const key = keyOf(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const safeUrl = (rawUrl) => {
    try {
      const url = new URL(rawUrl, window.location.href);
      if (url.protocol === "javascript:") return cleanText(sanitizeScriptHref(rawUrl), 1000);
      for (const key of [...url.searchParams.keys()]) {
        if (/token|ticket|secret|password|session|auth|code|merchant|merid/i.test(key)) {
          url.searchParams.set(key, "[已隐藏]");
        }
      }
      if (/access_token|refresh_token|session|auth/i.test(url.hash)) {
        url.hash = "#[已隐藏]";
      }
      return url.href.slice(0, 1000);
    } catch {
      return cleanText(rawUrl, 1000);
    }
  };

  const isVisible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.visibility !== "collapse" &&
      style.opacity !== "0" &&
      element.getClientRects().length > 0;
  };

  const isInteractive = (element) => {
    if (!(element instanceof Element)) return false;
    const role = (element.getAttribute("role") || "").toLowerCase();
    return element.tagName === "A" || element.tagName === "BUTTON" ||
      element.hasAttribute("onclick") || role === "button" ||
      window.getComputedStyle(element).cursor === "pointer";
  };

  const merchantLabelText = (element) => cleanText(
    element.innerText || element.textContent,
    120
  );

  const findMerchantLabelControls = (label) => {
    const selector = 'a,button,[role="button"],[onclick],[data-toggle],div,span';
    const matches = [...document.querySelectorAll(selector)]
      .filter(isVisible)
      .filter((element) => merchantLabelText(element) === label)
      .map((element) => ({ element, clickable: isInteractive(element) }))
      .sort((left, right) => Number(right.clickable) - Number(left.clickable));
    const picked = [];
    for (const item of matches) {
      if (picked.some((existing) => existing.element.contains(item.element) || item.element.contains(existing.element))) {
        continue;
      }
      picked.push(item);
    }
    return picked.slice(0, 4).map(({ element, clickable }) => ({
      element,
      data: {
        found: true,
        text: label,
        tag: element.tagName.toLowerCase(),
        selector: selectorFor(element),
        clickable,
        className: cleanText(typeof element.className === "string" ? element.className : "", 160),
        onclick: describeHandler(element.getAttribute("onclick"))
      }
    }));
  };

  const extractCurrentMerchant = (container, semanticLabel = "当前商户") => {
    const lines = String(container.innerText || container.textContent || "")
      .split(/[\r\n]+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const labelPattern = new RegExp(`^${semanticLabel}\\s*[:：]?\\s*(.*)$`);
    const ignored = /^(当前商户|商户名称|切换商户|选择商户|我的商户|展开|收起|更多|关闭|商户号|商户编号|商户信息|营业执照|身份证|到期日期|离到期还有|×|暂无|未选择|未识别|未知|加载中|请选择.*)$/;

    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(labelPattern);
      if (!match) continue;
      const inlineValue = match[1].trim();
      if (inlineValue && !ignored.test(inlineValue)) return inlineValue;
      const nextValue = lines.slice(index + 1).find((line) => !ignored.test(line));
      if (nextValue) return nextValue;
    }
    return null;
  };

  const detectMerchant = () => {
    const merchantControls = findMerchantLabelControls("我的商户");
    const switchControls = findMerchantLabelControls("切换商户");
    const semanticNodes = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let textNode;
    let examinedNodes = 0;
    while ((textNode = walker.nextNode()) && examinedNodes < 12000) {
      examinedNodes += 1;
      const nodeText = textNode.nodeValue || "";
      const label = /当前商户/.test(nodeText) ? "当前商户" : /商户名称/.test(nodeText) ? "商户名称" : null;
      if (!label) continue;
      const parent = textNode.parentElement;
      if (parent && isVisible(parent)) semanticNodes.push({ element: parent, label });
    }
    const uniqueSemanticNodes = semanticNodes.filter((item, index, all) =>
      all.findIndex((other) => other.element === item.element && other.label === item.label) === index
    )
      .sort((left, right) => merchantLabelText(left.element).length - merchantLabelText(right.element).length)
      .slice(0, 80);

    let current = null;
    let source = null;
    let confidence = "low";
    for (const semanticNode of uniqueSemanticNodes) {
      let candidate = semanticNode.element;
      for (let depth = 0; candidate && depth < 4; depth += 1, candidate = candidate.parentElement) {
        const text = String(candidate.innerText || candidate.textContent || "");
        if (text.length > 500) continue;
        if (semanticNode.label === "商户名称" && !/(当前商户|我的商户|切换商户)/.test(text)) continue;
        const value = extractCurrentMerchant(candidate, semanticNode.label);
        if (value) {
          current = cleanText(value, 180);
          source = "merchant-panel";
          confidence = semanticNode.label === "当前商户" ? "high" : "medium";
          break;
        }
      }
      if (current) break;
    }

    if (!current) {
      for (const control of merchantControls) {
        let candidate = control.element;
        for (let depth = 0; candidate && depth < 4; depth += 1, candidate = candidate.parentElement) {
          if (String(candidate.innerText || "").length > 300) continue;
          const value = extractCurrentMerchant(candidate, "我的商户");
          if (value && /(公司|集团|商城|商场|商贸|商户|中心|合作社|个体)/.test(value)) {
            current = cleanText(value, 180);
            source = "top-navigation";
            confidence = "medium";
            break;
          }
        }
        if (current) break;
      }
    }

    if (!current) {
      const attributeNames = ["data-current-merchant", "data-merchant-name", "data-merchant"];
      const nearby = merchantControls
        .map((control) => control.element);
      for (const control of nearby) {
        let candidate = control;
        for (let depth = 0; candidate && depth < 4; depth += 1, candidate = candidate.parentElement) {
          for (const attribute of attributeNames) {
            const value = candidate.getAttribute(attribute);
            if (value && cleanText(value, 180)) {
              current = cleanText(value, 180);
              source = "data-attribute";
              confidence = "medium";
              break;
            }
          }
          if (current) break;
        }
        if (current) break;
      }
    }

    const currentLabelVisible = uniqueSemanticNodes.some((item) => item.label === "当前商户");
    const merchantNameLabelVisible = uniqueSemanticNodes.some((item) => item.label === "商户名称");
    return {
      target: SITE_CONFIG.targetMerchant,
      current,
      status: current
        ? cleanText(current, 180).replace(/\s/g, "") === SITE_CONFIG.targetMerchant.replace(/\s/g, "")
          ? "matched"
          : "mismatched"
        : "unknown",
      confidence: current ? confidence : "low",
      source,
      merchantControl: merchantControls[0]?.data || { found: false },
      switchControl: switchControls[0]?.data || { found: false },
      merchantPanel: {
        visible: currentLabelVisible || (merchantNameLabelVisible && switchControls.length > 0),
        currentMerchantLabelVisible: currentLabelVisible,
        merchantNameLabelVisible,
        switchAvailable: switchControls.length > 0
      }
    };
  };

  const labelFor = (element) => {
    const explicit = element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      [...(element.labels || [])].map((label) => label.innerText).join(" ");
    if (explicit) return cleanText(explicit, 160);

    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labels = labelledBy.split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText || "")
        .join(" ");
      if (labels.trim()) return cleanText(labels, 160);
    }

    return cleanText(element.getAttribute("placeholder"), 160);
  };

  const readableName = (element, limit = 160) => cleanText(
    element.getAttribute("aria-label") ||
    element.getAttribute("title") ||
    element.innerText ||
    element.textContent ||
    (element instanceof HTMLInputElement ? element.value : ""),
    limit
  );

  const selectorFor = (element) => {
    const tag = element.tagName.toLowerCase();
    if (element.id) return tag + "#" + CSS.escape(element.id);
    const classes = typeof element.className === "string"
      ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2)
      : [];
    if (classes.length) return tag + "." + classes.map((name) => CSS.escape(name)).join(".");
    const role = element.getAttribute("role");
    return role ? tag + '[role="' + role.replace(/"/g, "\\\"") + '"]' : tag;
  };

  const collectInteractiveElements = () => dedupeBy(
    [...document.querySelectorAll('a,button,[role="button"],[onclick],[data-toggle],div,span')]
      .filter(isVisible)
      .filter(isInteractive)
      .filter((element) => !isNoiseControl(element, readableName(element)))
      .map((element) => ({
        text: readableName(element, 140),
        tag: element.tagName.toLowerCase(),
        selector: selectorFor(element),
        clickable: true,
        role: cleanText(element.getAttribute("role"), 60),
        className: cleanText(typeof element.className === "string" ? element.className : "", 140),
        onclick: describeHandler(element.getAttribute("onclick"))
      }))
      .filter((item) => item.text),
    (item) => `${item.text}|${item.selector}`
  ).slice(0, 120);

  const collectVisibleText = () => {
    if (!document.body) return "";
    const ignored = "table,script,style,noscript,svg,canvas,iframe";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const lines = [];
    let characterCount = 0;
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest(ignored) || !isVisible(parent)) continue;
      const text = cleanText(node.nodeValue, 500);
      if (text && lines[lines.length - 1] !== text) {
        lines.push(text);
        characterCount += text.length + 1;
      }
      if (characterCount >= 7000) break;
    }
    return lines.join("\n").slice(0, 7000);
  };

  const scanElementDownloadDialog = () => {
    const dialog = [...document.querySelectorAll(".el-dialog")]
      .filter(isVisible)
      .find((element) => cleanText(
        element.querySelector(".el-dialog__title")?.innerText ||
        element.querySelector(".el-dialog__header")?.innerText,
        100
      ) === "下载暂存列表");
    if (!dialog) return null;

    const totalMatch = cleanText(dialog.innerText, 7000).match(/共\s*(\d+)\s*条/);
    const pageElement = dialog.querySelector(".el-pagination .number.active");
    const tables = [...dialog.querySelectorAll(".el-table")].filter(isVisible);
    const table = tables.map((element) => {
      const headers = [...element.querySelectorAll(
        ".el-table__header-wrapper thead th, .el-table__header-wrapper [role=columnheader]"
      )]
        .filter(isVisible)
        .map((cell) => cleanText(cell.querySelector(".cell")?.innerText || cell.innerText || cell.textContent, 100));
      const columns = {
        createdAt: headers.findIndex((header) => header.includes("创建时间")),
        fileName: headers.findIndex((header) => header.includes("文件名")),
        status: headers.findIndex((header) => header.includes("下载状态")),
        operation: headers.findIndex((header) => header.includes("操作"))
      };
      return { element, headers, columns };
    }).find(({ columns }) => Object.values(columns).every((index) => index >= 0));

    if (!table) {
      return {
        title: "下载暂存列表",
        total: totalMatch ? Number(totalMatch[1]) : null,
        page: pageElement ? Number(cleanText(pageElement.innerText, 20)) || null : null,
        headers: [],
        rowCount: 0,
        rows: [],
        parseState: "table_not_found"
      };
    }

    const body = table.element.querySelector(".el-table__body-wrapper");
    const rowSelector = "tbody > tr";
    const candidateRows = body
      ? [...body.querySelectorAll(rowSelector)]
      : [...table.element.querySelectorAll(rowSelector)];
    const rows = dedupeBy(candidateRows.filter(isVisible), (row) => row);
    const readCell = (cells, index) => cleanText(
      cells[index]?.querySelector(".cell")?.innerText || cells[index]?.innerText || cells[index]?.textContent,
      240
    );
    const parsedRows = rows.slice(0, 50).map((row) => {
      const cells = [...row.children].filter((cell) => cell.tagName === "TD");
      const operationCell = cells[table.columns.operation];
      const downloadControl = operationCell && [...operationCell.querySelectorAll('a,button,[role="button"]')]
        .find((element) => cleanText(element.innerText || element.textContent || element.getAttribute("aria-label"), 40) === "下载");
      const disabled = downloadControl
        ? Boolean(downloadControl.disabled) ||
          downloadControl.getAttribute("aria-disabled") === "true" ||
          downloadControl.classList.contains("is-disabled") ||
          Boolean(downloadControl.closest(".is-disabled"))
        : null;
      const status = readCell(cells, table.columns.status);

      return {
        createdAt: readCell(cells, table.columns.createdAt),
        fileName: readCell(cells, table.columns.fileName),
        status,
        statusCode: status === "待处理" ? "pending" : status === "处理成功" ? "ready" : "unknown",
        downloadEnabled: disabled === null ? null : !disabled
      };
    }).filter((row) => row.createdAt || row.fileName || row.status);

    return {
      title: "下载暂存列表",
      total: totalMatch ? Number(totalMatch[1]) : null,
      page: pageElement ? Number(cleanText(pageElement.innerText, 20)) || null : null,
      headers: table.headers,
      rowCount: parsedRows.length,
      rows: parsedRows,
      parseState: parsedRows.length ? "rows_found" : "table_found_empty"
    };
  };

  const resolveMainNavigation = () => {
    const items = [...document.querySelectorAll("a[href]")]
      .filter(isVisible)
      .flatMap((link) => {
        try {
          const url = new URL(link.href, window.location.href);
          const text = MAIN_NAV_ROUTES.get(url.pathname);
          if (url.hostname !== TARGET_HOST || !text) return [];
          return [{
            text,
            href: safeUrl(url.href),
            pathname: url.pathname,
            active: url.pathname === window.location.pathname ||
              window.location.pathname.startsWith(`${url.pathname}/`)
          }];
        } catch {
          return [];
        }
      });
    return dedupeBy(items, (item) => item.text + "|" + item.pathname);
  };

  const collectMenuGroups = (mainNavigation) => {
    const candidates = [...document.querySelectorAll(
      'nav,[role="navigation"],[role="menubar"],[role="menu"],[role="tree"],[class*="sidebar" i],[class*="menu" i]'
    )].filter(isVisible).slice(0, 18);
    const groups = [];
    const seenGroups = new Set();

    for (const candidate of candidates) {
      const clickable = [...candidate.querySelectorAll(
        'a,button,[role="menuitem"],[role="treeitem"],[role="button"],[onclick]'
      )]
        .filter(isVisible)
        .map((item) => readableName(item, 100))
        .filter(Boolean);
      const names = clickable.length ? clickable : [...candidate.querySelectorAll("li")]
        .filter(isVisible)
        .map((item) => cleanText(item.innerText, 100))
        .filter(Boolean);
      const items = [...new Set(names)].slice(0, 40);
      if (!items.length) continue;
      const key = items.join("|");
      if (seenGroups.has(key)) continue;
      seenGroups.add(key);
      groups.push({
        label: cleanText(candidate.getAttribute("aria-label") || candidate.className || candidate.tagName, 80),
        items
      });
    }

    if (mainNavigation.length) {
      groups.push({
        label: "站内主导航（按路由识别）",
        items: mainNavigation.map((item) => item.text)
      });
    }
    return groups;
  };

  const parseGotoUrl = (rawHref) => {
    const match = String(rawHref || "").match(/gotoUrl\s*\(\s*(['"])([\s\S]*?)\1\s*\)/i);
    return match?.[2] || "";
  };

  const resolveBusinessEntries = () => {
    const items = [...document.querySelectorAll("a[href]")]
      .filter(isVisible)
      .flatMap((link) => {
        const rawHref = link.getAttribute("href") || "";
        const target = parseGotoUrl(rawHref);
        if (!target) return [];
        const knownEntry = BUSINESS_ENTRY_ROUTES.find((entry) => entry.pattern.test(target));
        if (!knownEntry) return [];
        return [{
          text: readableName(link, 160) || knownEntry.text,
          type: "business_entry",
          rawHref: safeUrl(rawHref),
          target: cleanText(sanitizeScriptHref(target), 600)
        }];
      });
    return dedupeBy(items, (item) => item.text + "|" + item.target);
  };

  const isNoiseControl = (element, text) => {
    if (/^go to slide\s+\d+$/i.test(text)) return true;
    const className = typeof element.className === "string" ? element.className.toLowerCase() : "";
    return NOISE_CLASSES.some((name) => className.includes(name));
  };

  const scanCurrentFrame = () => {
    const isTopFrame = window.top === window;
    const path = window.location.pathname;
    const isPortalPage = path.startsWith(`${SITE_CONFIG.portalRoot}/`);
    const isBusinessFrame = path === SITE_CONFIG.frontendRoot || path.startsWith(`${SITE_CONFIG.frontendRoot}/`);
    if (window.location.hostname !== TARGET_HOST || (!isPortalPage && !isBusinessFrame)) return null;

    const mainNavigation = resolveMainNavigation();
    const menuGroups = collectMenuGroups(mainNavigation);
    const menus = [...new Set(menuGroups.flatMap((group) => group.items))];
    const businessEntries = resolveBusinessEntries();
    const merchant = detectMerchant();
    const interactiveElements = collectInteractiveElements();
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]")]
      .filter(isVisible)
      .map((element) => cleanText(element.innerText || element.textContent, 180))
      .filter(Boolean)
      .slice(0, 60);

    const buttons = [...document.querySelectorAll(
      'button,input[type="button"],input[type="submit"],input[type="reset"],[role="button"]'
    )]
      .filter(isVisible)
      .filter((element) => !isNoiseControl(element, readableName(element)))
      .map((element) => ({
        text: readableName(element),
        type: element.getAttribute("type") || element.tagName.toLowerCase(),
        selector: selectorFor(element),
        disabled: Boolean(element.disabled)
      }))
      .filter((item) => item.text)
      .slice(0, 100);

    const links = [...document.querySelectorAll("a[href]")]
      .filter(isVisible)
      .map((element) => {
        const rawHref = element.getAttribute("href") || "";
        const javascriptHref = /^\s*javascript:/i.test(rawHref);
        return {
          text: readableName(element),
          href: javascriptHref ? safeUrl(rawHref) : safeUrl(element.href),
          ...(javascriptHref ? { rawHref: safeUrl(rawHref) } : {})
        };
      })
      .slice(0, 80);

    const inputs = [...document.querySelectorAll("input,select,textarea")]
      .filter(isVisible)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute("type") || element.tagName.toLowerCase(),
        label: labelFor(element),
        name: cleanText(element.getAttribute("name"), 100),
        id: cleanText(element.id, 100),
        required: Boolean(element.required),
        disabled: Boolean(element.disabled),
        options: element instanceof HTMLSelectElement
          ? [...element.options].slice(0, 20).map((option) => cleanText(option.text, 80)).filter(Boolean)
          : []
      }))
      .slice(0, 60);

    const tables = [...document.querySelectorAll("table")]
      .filter(isVisible)
      .slice(0, 10)
      .map((table, index) => {
        const rows = [...table.querySelectorAll("tr")].filter(isVisible);
        const explicitHeaders = [...table.querySelectorAll("thead th,[role=columnheader]")]
          .filter(isVisible)
          .map((cell) => cleanText(cell.innerText || cell.textContent, 140))
          .filter(Boolean);
        const firstRow = rows[0];
        const firstRowCells = firstRow ? [...firstRow.querySelectorAll("th,td")] : [];
        const hasHeadSection = Boolean(table.querySelector("thead"));
        const firstRowIsHeader = Boolean(firstRow) && (
          hasHeadSection ||
          firstRowCells.some((cell) => cell.tagName === "TH" || cell.getAttribute("role") === "columnheader") ||
          /head|header|title/i.test(String(firstRow.className) + " " + String(firstRow.parentElement?.className || ""))
        );
        const inferredHeaders = firstRowIsHeader
          ? firstRowCells.map((cell) => cleanText(cell.innerText || cell.textContent, 140))
          : [];
        const headers = explicitHeaders.length ? explicitHeaders : inferredHeaders;
        const headerRows = hasHeadSection
          ? [...table.querySelectorAll("thead tr")].filter(isVisible).length
          : firstRowIsHeader ? 1 : 0;
        const dataRows = rows.slice(headerRows);
        return {
          index: index + 1,
          headers: headers.slice(0, 30),
          rowCount: dataRows.length,
          previewRows: dataRows.slice(0, 3).map((row) =>
            [...row.querySelectorAll("th,td")]
              .slice(0, 30)
              .map((cell) => cleanText(cell.innerText || cell.textContent, 100))
          )
        };
      });
    const downloadTaskList = scanElementDownloadDialog();

    const iframes = [...document.querySelectorAll("iframe")]
      .slice(0, 32)
      .map((frame, index) => {
        const sourceUrl = frame.getAttribute("src") ? safeUrl(frame.src) : "";
        let documentUrl = "";
        try {
          const rawDocumentUrl = frame.contentWindow?.location?.href;
          documentUrl = rawDocumentUrl ? safeUrl(rawDocumentUrl) : "";
        } catch {
          // Cross-origin frame locations are intentionally not read.
        }
        return {
          index: index + 1,
          url: sourceUrl || documentUrl,
          documentUrl,
          title: cleanText(frame.title, 160),
          name: cleanText(frame.getAttribute("name"), 120),
          visible: isVisible(frame),
          sandbox: frame.getAttribute("sandbox") || ""
        };
      });

    const visibleText = collectVisibleText();
    const names = [...links.map((item) => item.text), ...buttons.map((item) => item.text)];
    const inputLabels = inputs.map((item) => item.label).filter(Boolean);
    const loginControls = names.some((name) => /^(登录|立即登录|用户登录|商户登录)$/.test(name));
    const logoutControls = names.some((name) => /^(退出|退出登录|安全退出|注销)$/.test(name));
    const businessNavigation = mainNavigation.length >= 2 ||
      menus.some((name) => /账务|报表|交易|商户|数据|对账|结算|订单/.test(name));
    const accountLabelCue = [...document.querySelectorAll("label,th,td,dt,[class*=label i],[class*=name i]")]
      .filter(isVisible)
      .some((element) => /^(商户名称|商户号|商户编号|商户编码|当前商户|用户名)$/.test(
        cleanText(element.innerText || element.textContent, 80)
      ));
    const accountCue = /商户名称|商户号|商户编号|当前用户|用户名|欢迎您|我的商户/.test(visibleText) ||
      inputLabels.some((label) => /商户|用户|账号/.test(label)) ||
      accountLabelCue || merchant.merchantControl?.found === true;

    return {
      url: safeUrl(window.location.href),
      title: cleanText(document.title, 240),
      isTopFrame,
      frameName: "",
      visibleText,
      headings,
      menuGroups,
      mainNavigation,
      businessEntries,
      interactiveElements,
      merchant,
      menus,
      buttons,
      links,
      inputs,
      tables,
      downloadTaskList,
      iframes,
      signals: {
        hasPasswordInput: inputs.some((input) => input.type.toLowerCase() === "password"),
        loginControls,
        logoutControls,
        accountCue,
        businessNavigation
      }
    };
  };

  globalThis.__chinaumsAssistantScan = (siteConfig) => {
    if (!siteConfig?.host || !siteConfig?.portalRoot || !siteConfig?.frontendRoot || !siteConfig?.targetMerchant ||
      !Array.isArray(siteConfig.mainNavigation)) {
      throw new Error("页面扫描配置缺失或无效，请重新加载扩展后重试。");
    }
    SITE_CONFIG = siteConfig;
    TARGET_HOST = siteConfig.host;
    MAIN_NAV_ROUTES = new Map(siteConfig.mainNavigation.map((item) => [item.path, item.label]));
    return scanCurrentFrame();
  };
})();
