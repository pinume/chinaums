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
  const cleanText = (value, limit = 240) =>
    String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);

  const sanitizeScriptHref = (rawHref) => String(rawHref || "").replace(
    /([?&](?:token|ticket|secret|password|session|auth|code|merchantId|merId)=)[^&'"\s)]+/gi,
    "$1[已隐藏]"
  );

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
      data: { found: true, text: label, clickable }
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
    const headerUserInfo = document.querySelector(".usersImg .userInfo, header .userInfo");
    let current = null;
    let source = null;

    if (headerUserInfo) {
      const value = extractCurrentMerchant(headerUserInfo, "当前商户") ||
        extractCurrentMerchant(headerUserInfo, "商户名称");
      if (value) {
        current = cleanText(value, 180);
        source = "merchant-panel";
      }
    }

    if (!current) {
      const candidates = [...document.querySelectorAll("header, nav, .header, .top-bar, .user-info, .account-info, div, span")]
        .filter(isVisible)
        .slice(0, 60);
      for (const el of candidates) {
        const text = el.innerText || "";
        if (text.length > 300) continue;
        const val = extractCurrentMerchant(el, "当前商户") || extractCurrentMerchant(el, "商户名称");
        if (val) {
          current = cleanText(val, 180);
          source = "merchant-panel";
          break;
        }
      }
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
            break;
          }
        }
        if (current) break;
      }
    }

    return {
      current,
      source,
      merchantControl: merchantControls[0]?.data || { found: false }
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

  const collectVisibleText = () => cleanText(document.body?.innerText || "", 7000);

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

  const scanCurrentFrame = () => {
    const isTopFrame = window.top === window;
    const path = window.location.pathname;
    const isPortalPage = path.startsWith(`${SITE_CONFIG.portalRoot}/`);
    const isBusinessFrame = path === SITE_CONFIG.frontendRoot || path.startsWith(`${SITE_CONFIG.frontendRoot}/`);
    if (window.location.hostname !== TARGET_HOST || (!isPortalPage && !isBusinessFrame)) return null;

    const mainNavigation = resolveMainNavigation();
    const businessEntries = resolveBusinessEntries();
    const merchant = detectMerchant();

    const buttons = [...document.querySelectorAll(
      'button,input[type="button"],input[type="submit"],input[type="reset"],[role="button"]'
    )]
      .filter(isVisible)
      .map((element) => ({
        text: readableName(element),
        type: element.getAttribute("type") || element.tagName.toLowerCase(),
        disabled: Boolean(element.disabled)
      }))
      .filter((item) => item.text)
      .slice(0, 100);

    const links = [...document.querySelectorAll("a[href]")]
      .filter(isVisible)
      .map((element) => ({ text: readableName(element), href: safeUrl(element.href) }))
      .slice(0, 80);

    const inputs = [...document.querySelectorAll("input,select,textarea")]
      .filter(isVisible)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute("type") || element.tagName.toLowerCase(),
        label: labelFor(element)
      }))
      .slice(0, 60);

    const visibleText = collectVisibleText();
    const names = [...links.map((item) => item.text), ...buttons.map((item) => item.text)];
    const inputLabels = inputs.map((item) => item.label).filter(Boolean);
    const loginControls = names.some((name) => /^(登录|立即登录|用户登录|商户登录)$/.test(name));
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
      mainNavigation,
      businessEntries,
      merchant,
      signals: {
        hasPasswordInput: inputs.some((input) => input.type.toLowerCase() === "password"),
        loginControls,
        accountCue
      }
    };
  };

  globalThis.__chinaumsAssistantScan = (siteConfig) => {
    if (!siteConfig?.host || !siteConfig?.portalRoot || !siteConfig?.frontendRoot ||
      !Array.isArray(siteConfig.mainNavigation)) {
      throw new Error("页面扫描配置缺失或无效，请重新加载扩展后重试。");
    }
    SITE_CONFIG = siteConfig;
    TARGET_HOST = siteConfig.host;
    MAIN_NAV_ROUTES = new Map(siteConfig.mainNavigation.map((item) => [item.path, item.label]));
    return scanCurrentFrame();
  };
})();
