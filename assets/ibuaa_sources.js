(() => {
  "use strict";

  const REQUEST_TIMEOUT_MS = 15000;
  const SPOC_KEY_TEXT = "inco12345678ocni";
  const SPOC_IV_TEXT = "ocni12345678inco";
  const SPOC_TERM_PARAM =
    "YHrxtTavu6raCwC0/qdgYffB9evWHBkTng/XS4W6j3f/TPo02iEPSoegscDTRNzIPRG49o3RHl4JiFCXAiBkkA==";
  const SPOC_ASSIGNMENT_SQL_ID =
    "1713252980496efac7d5d9985e81693116d3e8a52ebf2b";
  const BYKC_RSA_PUBLIC_KEY =
    "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDlHMQ3B5GsWnCe7Nlo1YiG/YmHdlOiKOST5aRm4iaqYSvhvWmwcigoyWTM+8bv2+sf6nQBRDWTY4KmNV7DBk1eDnTIQo6ENA31k5/tYCLEXgjPbEjCK9spiyB62fCT6cqOhbamJB0lcDJRO6Vo1m3dy+fD0jbxfDVBBNtyltIsDQIDAQAB";
  const BYKC_KEY_CHARS =
    "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
  const WEBVPN_BASES = Object.freeze({
    "byxt.buaa.edu.cn":
      "https://d.buaa.edu.cn/https/77726476706e69737468656265737421f2ee598869327d517f468ca88d1b203b",
    "spoc.buaa.edu.cn":
      "https://d.buaa.edu.cn/https/77726476706e69737468656265737421e3e74e9f69327d517f468ca88d1b203b",
    "judge.buaa.edu.cn":
      "https://d.buaa.edu.cn/https/77726476706e69737468656265737421fae2459b227e6a457f09c7a99c406d36fa",
    "booking.lib.buaa.edu.cn":
      "https://d.buaa.edu.cn/https/77726476706e69737468656265737421f2f84e972e3e6f1e72018be29a4022341d934536c87fa5",
    "bykc.buaa.edu.cn":
      "https://d.buaa.edu.cn/https/77726476706e69737468656265737421f2ee4a9f69327d517f468ca88d1b203b",
    "app.buaa.edu.cn":
      "https://d.buaa.edu.cn/https/77726476706e69737468656265737421f1e751d225256951300d8db9d6562d",
  });

  function text(value, fallback = "") {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function object(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  }

  function localDateValue(date = new Date()) {
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}`;
  }

  function parseJson(value, fallback = null) {
    try {
      return JSON.parse(String(value || ""));
    } catch {
      return fallback;
    }
  }

  function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  function labelError(label, error) {
    if (!error) return new Error(label);
    const message = text(error.message, String(error));
    if (label && !message.startsWith(`${label}：`)) {
      error.message = `${label}：${message}`;
    }
    return error;
  }

  async function withReadRetry(label, task, attempts = 2) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await task();
      } catch (error) {
        lastError = labelError(label, error);
        const retryable =
          /HTTP\s+(?:429|5\d\d)|timeout|timed out|network|failed to fetch/i.test(
            String(error?.message || error)
          );
        if (!retryable || attempt >= attempts) throw lastError;
        await delay(450 * attempt);
      }
    }
    throw lastError || new Error(label);
  }

  async function waitForValue(read, timeoutMs = 6000, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs;
    do {
      const value = text(read());
      if (value) return value;
      await delay(intervalMs);
    } while (Date.now() < deadline);
    return "";
  }

  function reportProgress(message) {
    try {
      globalThis.BUAASchedule?.progress?.(String(message || ""));
    } catch {}
  }

  function storageToken(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    let parsed = raw;
    try {
      parsed = JSON.parse(raw);
      if (typeof parsed === "string") parsed = JSON.parse(parsed);
    } catch {}
    if (typeof parsed === "string") return parsed.trim();
    if (parsed && typeof parsed === "object") {
      return text(
        parsed.token ||
          parsed.auth_token ||
          parsed.authtoken ||
          parsed.cas ||
          parsed.value
      );
    }
    return raw.replace(/^"+|"+$/g, "").trim();
  }

  function findStoredToken(keys = []) {
    const normalizedKeys = keys.map(value => String(value).toLowerCase());
    const stores = [];
    try {
      stores.push(localStorage);
    } catch {}
    try {
      stores.push(sessionStorage);
    } catch {}
    for (const store of stores) {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index) || "";
        const lowered = key.toLowerCase();
        if (
          normalizedKeys.some(
            candidate =>
              lowered === candidate ||
              lowered.endsWith(`.${candidate}`) ||
              lowered.endsWith(`_${candidate}`) ||
              lowered.endsWith(`-${candidate}`)
          )
        ) {
          const token = storageToken(store.getItem(key));
          if (token) return token;
        }
      }
    }
    const resources =
      globalThis.performance
        ?.getEntriesByType?.("resource")
        ?.map(entry => entry.name) || [];
    for (const candidate of [
      location.href,
      globalThis.document?.referrer || "",
      ...resources,
    ]) {
      try {
        const url = new URL(candidate);
        for (const key of keys) {
          const token = url.searchParams.get(key);
          if (token) return token;
        }
      } catch {}
    }
    return "";
  }

  function bykcAngularToken() {
    try {
      const angular = globalThis.angular;
      if (!angular) return "";
      const element =
        angular.element(document.body || document.documentElement);
      const injector = element?.injector?.();
      const token = injector?.get?.("AuthService")?.getToken?.();
      return text(token);
    } catch {
      return "";
    }
  }

  function spocStoredSession() {
    let userinfo = {};
    try {
      userinfo = parseJson(localStorage.getItem("userinfo"), {}) || {};
    } catch {}
    return {
      token: text(
        localStorage.getItem("token") ||
          sessionStorage.getItem("buaa_spoc_token")
      ),
      roleCode: text(
        localStorage.getItem("lastloginrole") || userinfo.jsdm
      ),
    };
  }

  async function waitForSpocSession(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    do {
      const stored = spocStoredSession();
      if (stored.token && stored.roleCode) return stored;
      await delay(250);
    } while (Date.now() < deadline);
    return spocStoredSession();
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(
        ...bytes.subarray(index, index + 0x8000)
      );
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || "").replace(/\s+/g, ""));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  function utf8(value) {
    return new TextEncoder().encode(String(value));
  }

  function concatBytes(...chunks) {
    const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  function upstreamUrl(url) {
    if (location.hostname !== "d.buaa.edu.cn") return url;
    try {
      const parsed = new URL(url);
      const base = WEBVPN_BASES[parsed.hostname];
      if (!base) return url;
      const path = parsed.pathname === "/" ? "" : parsed.pathname;
      return (
        base +
        path +
        (parsed.search || "") +
        (parsed.hash || "")
      );
    } catch {
      return url;
    }
  }

  function looksLikeLoginResponse(response, body) {
    const value = String(body || "");
    return (
      response?.url?.includes("sso.buaa.edu.cn") ||
      response?.status === 401 ||
      value.includes("统一身份认证") ||
      value.includes("input name=\"execution\"") ||
      /<title>\s*[^<]*登录/i.test(value)
    );
  }

  async function fetchText(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
        ...options,
      });
      const body = await response.text();
      return { response, body };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchJson(url, options = {}) {
    const { response, body } = await fetchText(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (looksLikeLoginResponse(response, body)) {
      const error = new Error("登录状态已失效");
      error.needLogin = true;
      throw error;
    }
    try {
      return JSON.parse(body);
    } catch {
      const error = new Error("校园系统返回了非 JSON 数据");
      error.needLogin = /cas|login|统一身份认证/i.test(response.url);
      throw error;
    }
  }

  function xhrJson(url, options = {}, timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        callback(value);
      };
      const watchdog = setTimeout(() => {
        try {
          request.abort();
        } catch {}
        finish(reject, new Error("请求超时"));
      }, timeoutMs + 250);
      request.open(options.method || "GET", url, true);
      request.withCredentials = true;
      request.timeout = timeoutMs;
      request.setRequestHeader("Accept", "application/json, text/plain, */*");
      request.setRequestHeader("X-Requested-With", "XMLHttpRequest");
      for (const [name, value] of Object.entries(options.headers || {})) {
        if (value != null && String(value).trim()) {
          request.setRequestHeader(name, String(value));
        }
      }
      request.onload = () => {
        if (request.status < 200 || request.status >= 300) {
          finish(reject, new Error(`HTTP ${request.status}`));
          return;
        }
        try {
          finish(resolve, JSON.parse(request.responseText));
        } catch {
          finish(reject, new Error("校园接口返回了非 JSON 数据"));
        }
      };
      request.onerror = () => finish(reject, new Error("网络请求失败"));
      request.ontimeout = () => finish(reject, new Error("请求超时"));
      request.onabort = () => finish(reject, new Error("请求已取消"));
      request.send(options.body == null ? null : options.body);
    });
  }

  function xhrText(url, options = {}, timeoutMs = 9000) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        callback(value);
      };
      const watchdog = setTimeout(() => {
        try {
          request.abort();
        } catch {}
        finish(reject, new Error("请求超时"));
      }, timeoutMs + 250);
      request.open(options.method || "GET", url, true);
      request.withCredentials = true;
      request.timeout = timeoutMs;
      request.setRequestHeader(
        "Accept",
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      );
      for (const [name, value] of Object.entries(options.headers || {})) {
        request.setRequestHeader(name, String(value));
      }
      request.onload = () => {
        finish(resolve, {
          response: {
            ok: request.status >= 200 && request.status < 300,
            status: request.status,
            url: request.responseURL || url,
          },
          body: request.responseText || "",
        });
      };
      request.onerror = () => finish(reject, new Error("网络请求失败"));
      request.ontimeout = () => finish(reject, new Error("请求超时"));
      request.onabort = () => finish(reject, new Error("请求已取消"));
      request.send(options.body == null ? null : options.body);
    });
  }

  async function fetchPage(url, options = {}, timeoutMs = 9000) {
    if (typeof XMLHttpRequest === "function") {
      return xhrText(url, options, timeoutMs);
    }
    return fetchText(url, options);
  }

  function inferredSpocTerm() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const startYear = month >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    const endYear = startYear + 1;
    const semester = month >= 2 && month < 8 ? "2" : "1";
    return {
      termCode: `${startYear}-${endYear}${semester}`,
      termName: `${startYear}-${endYear}学年${semester === "1" ? "秋季" : "春季"}学期`,
    };
  }

  async function requestSpocTerm(headers) {
    try {
      const url = upstreamUrl(
        "https://spoc.buaa.edu.cn/spocnewht/inco/ht/queryOne"
      );
      const options = {
        method: "POST",
        headers,
        body: JSON.stringify({ param: SPOC_TERM_PARAM }),
      };
      const payload =
        typeof XMLHttpRequest === "function"
          ? await xhrJson(url, options)
          : await fetchJson(url, options);
      if (payload?.code !== 200 || payload?.content == null) {
        throw new Error(
          text(payload?.msg || payload?.msg_en, "SPOC 学期接口失败")
        );
      }
      const content = object(payload.content);
      const termCode = text(
        content.mrxq ||
          content.dqxnxq ||
          content.xnxq ||
          content.currentTerm
      );
      if (termCode) {
        return {
          termCode,
          termName: text(
            content.dqxq || content.xnxqmc || content.termName,
            termCode
          ),
        };
      }
    } catch (error) {
      reportProgress("SPOC：学期接口无响应，按当前日期继续");
      await delay(250);
    }
    return inferredSpocTerm();
  }

  async function safeCollect(collector) {
    try {
      const data = await collector();
      return { ok: true, data };
    } catch (error) {
      const message = text(error?.message, "同步失败");
      const networkFailure =
        /failed to fetch|load failed|networkerror|network error|timeout|timed out/i.test(
          message
        );
      const serverFailure = /HTTP\s+(?:429|5\d\d)/i.test(message);
      return {
        ok: false,
        needLogin:
          Boolean(error?.needLogin) ||
          /http 401|http 403/i.test(message),
        retryable: networkFailure || serverFailure,
        error: message,
      };
    }
  }

  async function aesCbcZeroPad(plainText) {
    const plain = utf8(plainText);
    const paddedLength = Math.ceil(plain.length / 16) * 16;
    const padded = new Uint8Array(Math.max(16, paddedLength));
    padded.set(plain);
    const roundKeys = aesKeyExpansion(utf8(SPOC_KEY_TEXT));
    let previous = utf8(SPOC_IV_TEXT);
    const chunks = [];
    for (let offset = 0; offset < padded.length; offset += 16) {
      const block = padded.slice(offset, offset + 16);
      for (let index = 0; index < 16; index += 1) {
        block[index] ^= previous[index];
      }
      const encrypted = aesEncryptBlock(block, roundKeys);
      chunks.push(encrypted);
      previous = encrypted;
    }
    return bytesToBase64(concatBytes(...chunks));
  }

  async function collectSpocModernAssignments(termCode, headers) {
    const query = new URLSearchParams({
      pageNum: "1",
      pageSize: "100",
      xnxq: termCode,
      kcmc: "",
    });
    const payload = await withReadRetry("SPOC 作业库接口", () =>
      fetchJson(
        upstreamUrl(
          "https://spoc.buaa.edu.cn/spocnewht/kczy/queryAllXsKczyList?" +
            query.toString()
        ),
        { headers }
      )
    );
    if (payload?.code === 401) {
      const error = new Error("SPOC 登录状态已失效");
      error.needLogin = true;
      throw error;
    }
    if (payload?.code !== 200 || payload?.content == null) {
      throw new Error(
        text(payload?.msg || payload?.msg_en, "SPOC 作业库请求失败")
      );
    }
    const content = payload.content;
    const rows = array(
      content?.list ||
        content?.rows ||
        content?.records ||
        content?.data ||
        content
    );
    return rows
      .map(row => {
        const item = object(row);
        const id = text(
          item.zyid || item.id || item.kczyid || item.kczyId
        );
        const title = text(
          item.zymc || item.kczymc || item.title || item.name
        );
        if (!id || !title) return null;
        const rawStatus = text(item.tjzt || item.status);
        return {
          id,
          title,
          courseName: text(
            item.kcmc || item.kcmcName || item.courseName,
            "未命名课程"
          ),
          teacherName: text(
            item.skjs || item.teacherName || item.jsxm
          ),
          startAt: text(
            item.zykssj || item.kssj || item.startAt || item.startTime
          ).replace("T", " "),
          dueAt: text(
            item.zyjzsj || item.jzsj || item.dueAt || item.endTime
          ).replace("T", " "),
          score: text(item.mf || item.score),
          status:
            ["1", "已做", "已提交"].includes(rawStatus)
              ? "已提交"
              : ["0", "未做", "未提交"].includes(rawStatus)
                ? "未提交"
                : "状态待同步",
          rawStatus,
          source: "SPOC",
        };
      })
      .filter(Boolean);
  }

  async function collectSpoc() {
    const url = new URL(location.href);
    const storedSession = await waitForSpocSession();
    reportProgress("SPOC：已识别官网登录状态，正在读取学期");
    const token =
      url.searchParams.get("token") ||
      sessionStorage.getItem("buaa_spoc_token") ||
      storedSession.token ||
      findStoredToken([
        "spoc_token",
        "inco_token",
        "_token",
        "auth_token",
        "authtoken",
        "token",
      ]) ||
      "";
    if (!token) {
      const error = new Error("请先完成 SPOC 官方登录");
      error.needLogin = true;
      throw error;
    }
    sessionStorage.setItem("buaa_spoc_token", token);
    const baseHeaders = {
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
      Token: `Inco-${token}`,
    };
    let roleCode = storedSession.roleCode;
    if (!roleCode) {
      const login = await withReadRetry("SPOC 登录接口", () =>
        fetchJson(
          upstreamUrl("https://spoc.buaa.edu.cn/spocnewht/sys/casLogin"),
          {
            method: "POST",
            headers: {
              ...baseHeaders,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ token }),
          }
        )
      );
      roleCode = text(
        login?.content?.jsdm ||
          (Array.isArray(login?.content?.rolecode)
            ? login.content.rolecode[0]
            : login?.content?.rolecode) ||
          (Array.isArray(login?.content?.jsdmList)
            ? login.content.jsdmList[0]
            : login?.content?.jsdmList)
      );
    }
    if (!roleCode) {
      const error = new Error("SPOC 登录成功但没有返回角色信息");
      error.needLogin = true;
      throw error;
    }
    const headers = {
      ...baseHeaders,
      RoleCode: roleCode,
      "Content-Type": "application/json",
    };
    const unwrap = payload => {
      if (payload?.code !== 200 || payload?.content == null) {
        const error = new Error(
          text(payload?.msg || payload?.msg_en, "SPOC 请求失败")
        );
        error.needLogin = /登录|token|未认证|未登录|权限/i.test(
          error.message
        );
        throw error;
      }
      return payload.content;
    };
    const term = await requestSpocTerm(headers);
    const termCode = text(term.termCode);
    if (!termCode) throw new Error("未取得 SPOC 当前学期");

    reportProgress("SPOC：正在读取课程信息");
    const courseUrl =
      upstreamUrl(
        "https://spoc.buaa.edu.cn/spocnewht/jxkj/queryKclb?" +
          new URLSearchParams({ kcmc: "", xnxq: termCode }).toString()
      );
    let courses = [];
    try {
      courses = array(
        unwrap(
          await withReadRetry("SPOC 课程接口", () =>
            fetchJson(courseUrl, { headers }),
            1
          )
        )
      );
    } catch (error) {
      if (error?.needLogin) throw error;
      // Course metadata is optional for the assignment list. UBAA has the
      // same graceful fallback when queryKclb is temporarily unavailable.
      courses = [];
    }
    const courseMap = new Map(
      courses.map(course => [String(course.kcid || ""), course])
    );
    reportProgress("SPOC：正在读取作业列表");
    const assignments = [];
    try {
      for (let pageNum = 1; pageNum <= 20; pageNum += 1) {
        const plain = JSON.stringify({
          pageSize: 15,
          pageNum,
          sqlid: SPOC_ASSIGNMENT_SQL_ID,
          xnxq: termCode,
          kcid: "",
          yzwz: "",
        });
        const encrypted = await aesCbcZeroPad(plain);
        const page = object(
          unwrap(
            await withReadRetry("SPOC 作业接口", () =>
              fetchJson(
                upstreamUrl(
                  "https://spoc.buaa.edu.cn/spocnewht/inco/ht/queryListByPage"
                ),
                {
                  method: "POST",
                  headers,
                  body: JSON.stringify({ param: encrypted }),
                }
              )
            )
          )
        );
        const rows = array(page.list);
        for (const row of rows) {
          const course = object(courseMap.get(String(row.sskcid || "")));
          assignments.push({
            id: text(row.zyid || row.id),
            title: text(row.zymc, "未命名 SPOC 作业"),
            courseName: text(row.kcmc || course.kcmc, "未命名课程"),
            teacherName: text(course.skjs),
            startAt: text(row.zykssj).replace("T", " "),
            dueAt: text(row.zyjzsj).replace("T", " "),
            score: text(row.mf),
            status:
              ["1", "已做", "已提交"].includes(text(row.tjzt))
                ? "已提交"
                : ["0", "未做", "未提交"].includes(text(row.tjzt))
                  ? "未提交"
                  : "状态待同步",
            rawStatus: text(row.tjzt),
            source: "SPOC",
          });
        }
        if (
          !page.hasNextPage ||
          rows.length === 0 ||
          pageNum >= number(page.pages, pageNum)
        ) {
          break;
        }
      }
    } catch (error) {
      if (error?.needLogin) throw error;
      reportProgress("SPOC：旧作业接口不可用，正在切换作业库接口");
      const modernAssignments = await collectSpocModernAssignments(
        termCode,
        headers
      );
      return {
        termCode,
        termName: text(term.termName, termCode),
        assignments: modernAssignments,
      };
    }
    reportProgress("SPOC：作业同步完成");
    return {
      termCode,
      termName: text(term.termName, termCode),
      assignments,
    };
  }

  function parseHtml(value) {
    return new DOMParser().parseFromString(String(value || ""), "text/html");
  }

  function parseJudgeCourses(html) {
    const document = parseHtml(html);
    const courses = [];
    for (const anchor of document.querySelectorAll(
      'a[href*="courselist.jsp?courseID="]'
    )) {
      const courseId =
        String(anchor.getAttribute("href") || "").match(
          /courseID=(\d+)/i
        )?.[1] || "";
      const courseName = text(anchor.textContent);
      if (courseId && courseId !== "0" && courseName) {
        courses.push({ courseId, courseName });
      }
    }
    for (const option of document.querySelectorAll("select option")) {
      const value = text(
        option.getAttribute("value") ||
          option.getAttribute("data-course-id") ||
          option.getAttribute("data-courseid")
      );
      const courseName = text(option.textContent);
      if (/^\d+$/.test(value) && value !== "0" && courseName) {
        courses.push({ courseId: value, courseName });
      }
    }
    for (const node of document.querySelectorAll(
      "[data-course-id], [data-courseid], [onclick]"
    )) {
      const source = [
        node.getAttribute("data-course-id"),
        node.getAttribute("data-courseid"),
        node.getAttribute("onclick"),
        node.getAttribute("href"),
      ]
        .filter(Boolean)
        .join(" ");
      const courseId =
        source.match(/courseID\s*=\s*['"]?(\d+)/i)?.[1] || "";
      const courseName = text(
        node.getAttribute("data-course-name") || node.textContent
      );
      if (courseId && courseId !== "0" && courseName) {
        courses.push({ courseId, courseName });
      }
    }
    return [...new Map(courses.map(item => [item.courseId, item])).values()];
  }

  async function collectJudge() {
    reportProgress("希冀：正在检查官网登录状态");
    const unifiedLogin = [...document.querySelectorAll("a[href]")].find(
      anchor => {
        const label = text(anchor.textContent);
        const href = String(anchor.getAttribute("href") || "");
        return (
          /统一身份认证|统一认证/.test(label) &&
          /sso\.buaa\.edu\.cn|service=/.test(href)
        );
      }
    );
    if (unifiedLogin) {
      reportProgress("希冀：正在打开校园统一认证登录");
      location.assign(unifiedLogin.href);
      const error = new Error("正在打开希冀统一认证登录页");
      error.needLogin = true;
      throw error;
    }
    const base = upstreamUrl("https://judge.buaa.edu.cn");
    let first = {
      response: { ok: true, status: 200, url: location.href },
      body: document.documentElement?.outerHTML || "",
    };
    let courses = parseJudgeCourses(first.body);
    if (!courses.length) {
      reportProgress("希冀：正在读取课程列表");
      first = await withReadRetry("希冀课程页", () =>
        fetchPage(`${base}/courselist.jsp?courseID=0`)
      );
    }
    if (looksLikeLoginResponse(first.response, first.body)) {
      const error = new Error("请先完成希冀官方登录");
      error.needLogin = true;
      throw error;
    }
    if (!first.response.ok) throw new Error(`希冀 HTTP ${first.response.status}`);
    courses = parseJudgeCourses(first.body);
    let lastJudgePage = first.body;
    if (!courses.length) {
      const retry = await withReadRetry("希冀课程页", () =>
        fetchPage(`${base}/courselist.jsp?courseID=0`)
      );
      if (looksLikeLoginResponse(retry.response, retry.body)) {
        const error = new Error("请先完成希冀官方登录");
        error.needLogin = true;
        throw error;
      }
      lastJudgePage = retry.body;
      courses = parseJudgeCourses(retry.body);
    }
    if (!courses.length) {
      const error = new Error(
        String(lastJudgePage).includes("选择课程")
          ? "希冀已进入“选择课程”页，但统一认证会话尚未建立；请等待页面跳转完成后重试"
          : "希冀页面没有可读取的课程，请确认登录状态"
      );
      error.needLogin = true;
      throw error;
    }
    const assignments = [];
    for (const course of [...new Map(courses.map(item => [item.courseId, item])).values()]) {
      reportProgress(`希冀：正在读取“${course.courseName}”`);
      const selected = await withReadRetry("希冀选课接口", () =>
        fetchPage(
          `${base}/courselist.jsp?courseID=${encodeURIComponent(course.courseId)}`
        )
      );
      if (looksLikeLoginResponse(selected.response, selected.body)) {
        const error = new Error("希冀登录状态已失效");
        error.needLogin = true;
        throw error;
      }
      if (!selected.response.ok) {
        throw new Error(`希冀选课 HTTP ${selected.response.status}`);
      }
      const assignmentPage = await withReadRetry("希冀作业列表", () =>
        fetchPage(`${base}/assignment/index.jsp`)
      );
      if (
        looksLikeLoginResponse(
          assignmentPage.response,
          assignmentPage.body
        )
      ) {
        const error = new Error("希冀登录状态已失效");
        error.needLogin = true;
        throw error;
      }
      if (!assignmentPage.response.ok) {
        throw new Error(
          `希冀作业列表 HTTP ${assignmentPage.response.status}`
        );
      }
      const document = parseHtml(assignmentPage.body);
      const links = [
        ...document.querySelectorAll('a[href*="assignID="]'),
      ]
        .map(anchor => {
          const href = String(anchor.getAttribute("href") || "");
          if (href.includes("problemContent") || href.includes("judgeDetails")) {
            return null;
          }
          return {
            id: href.match(/assignID=(\d+)/)?.[1] || "",
            title: text(anchor.textContent),
          };
        })
        .filter(item => item?.id && item.title);
      for (const assignment of [...new Map(links.map(item => [item.id, item])).values()]) {
        if (assignments.length >= 100) break;
        const detail = await withReadRetry("希冀作业详情", () =>
          fetchPage(
            `${base}/assignment/index.jsp?assignID=${encodeURIComponent(
              assignment.id
            )}`
          )
        );
        if (looksLikeLoginResponse(detail.response, detail.body)) {
          const error = new Error("希冀登录状态已失效");
          error.needLogin = true;
          throw error;
        }
        const detailDocument = parseHtml(detail.body);
        const plain = text(detailDocument.body?.textContent).replace(
          /\s+/g,
          " "
        );
        const times = plain.match(
          /作业时间[：:]\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\s*至\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/
        );
        const score = plain.match(/总分[：:]\s*([\d.]+)/)?.[1] || "";
        const maxScore = plain.match(/作业满分[：:]\s*([\d.]+)/)?.[1] || "";
        assignments.push({
          id: assignment.id,
          title: assignment.title,
          courseName: course.courseName,
          startAt: times?.[1] ? `${times[1].length === 16 ? `${times[1]}:00` : times[1]}` : "",
          dueAt: times?.[2] ? `${times[2].length === 16 ? `${times[2]}:00` : times[2]}` : "",
          score,
          maxScore,
          status: /未提交|还未提交|未作答/.test(plain)
            ? "未提交"
            : score
              ? `已完成 ${score}${maxScore ? `/${maxScore}` : ""}`
              : "状态待同步",
          source: "希冀",
        });
      }
    }
    reportProgress("希冀：作业同步完成");
    return { assignments };
  }

  async function collectLibrary() {
    reportProgress("图书馆：已识别官网登录状态");
    const url = new URL(location.href);
    let token =
      text(
        sessionStorage.getItem("token") ||
          localStorage.getItem("token")
      ) ||
      (await waitForValue(
        () =>
          sessionStorage.getItem("token") ||
          localStorage.getItem("token"),
        4500,
        250
      ));
    if (!token) {
      const resolvedCas =
        url.searchParams.get("cas") ||
        sessionStorage.getItem("buaa_library_cas") ||
        findStoredToken(["cas", "cas_token", "authtoken", "auth_token"]);
      if (!resolvedCas) {
        const error = new Error("请先完成图书馆官方登录");
        error.needLogin = true;
        throw error;
      }
      sessionStorage.setItem("buaa_library_cas", resolvedCas);
      const login = await withReadRetry("图书馆登录接口", () =>
        fetchJson(
          upstreamUrl("https://booking.lib.buaa.edu.cn/v4/login/user"),
          {
            method: "POST",
            headers: {
              Accept: "application/json, text/plain, */*",
              "Content-Type": "application/json",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: JSON.stringify({ cas: resolvedCas }),
          }
        )
      );
      token = text(
        login?.data?.member?.token ||
          login?.data?.token ||
          login?.member?.token
      );
    }
    if (!token) {
      const error = new Error("图书馆登录成功但未返回访问令牌");
      error.needLogin = true;
      throw error;
    }
    const post = async (path, body) => {
      const url = upstreamUrl(
        `https://booking.lib.buaa.edu.cn/v4/${path}`
      );
      const options = {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          authorization: `bearer${token}`,
        },
        body: JSON.stringify(body),
      };
      const payload =
        typeof XMLHttpRequest === "function"
          ? await xhrJson(url, options, 8000)
          : await fetchJson(url, options);
      if (
        payload?.code === 10001 ||
        /登录失效|请重新登录|未登录/.test(
          text(payload?.message || payload?.msg)
        )
      ) {
        const error = new Error("图书馆登录状态已失效");
        error.needLogin = true;
        throw error;
      }
      if (Number(payload?.code) !== 0) {
        throw new Error(
          text(payload?.msg || payload?.message, `图书馆接口 ${path} 失败`)
        );
      }
      return payload;
    };
    reportProgress("图书馆：正在读取开放区域");
    const indexPayload = await post("space/index", {});
    const day = text(
      indexPayload?.data?.date ||
        indexPayload?.data?.today ||
        localDateValue()
    );
    reportProgress("图书馆：正在读取可用座位");
    const librariesPayload = await post("space/pick", {
      premisesIds: [],
      categoryIds: [],
      storeyIds: [],
      boutiqueIds: [],
      date: day,
    });
    const libraries = array(
      librariesPayload?.data?.area ||
        librariesPayload?.data?.list ||
        librariesPayload?.list ||
        librariesPayload?.data
    ).map(item => ({
      id: text(item.id),
      name: text(item.name || item.premisesName, "图书馆"),
      floorName: text(item.storeyName),
      freeNum: number(item.free_num ?? item.freeNum),
      totalNum: number(item.total_num ?? item.totalNum),
    }));
    reportProgress("图书馆：正在读取本人预约");
    const bookingsPayload = await post("member/seat", {
      type: "1",
      page: 1,
      limit: 100,
    });
    const bookings = array(
      bookingsPayload?.data?.data ||
        bookingsPayload?.data?.list ||
        bookingsPayload?.data
    ).map(item => ({
      id: text(item.id),
      name: text(item.nameMerge || item.name_merge || item.name, "图书馆预约"),
      areaName: text(item.name || item.area_name),
      seatNo: text(item.no || item.seat_no),
      day: text(item.day || item.date),
      beginTime: text(item.beginTime || item.begin_time),
      endTime: text(item.endTime || item.end_time),
      status: text(item.status),
      statusName: text(item.status_name || item.statusName),
    }));
    return {
      availableSeats: libraries.reduce(
        (total, item) => total + number(item.freeNum),
        0
      ),
      seats: libraries,
      bookings,
      loans: [],
      updatedDay: day,
    };
  }

  function derRead(bytes, offset, end) {
    if (offset + 2 > end) throw new Error("RSA 公钥格式错误");
    const tag = bytes[offset];
    let index = offset + 1;
    let length = bytes[index++];
    if (length & 0x80) {
      const count = length & 0x7f;
      length = 0;
      for (let cursor = 0; cursor < count; cursor += 1) {
        length = (length << 8) | bytes[index++];
      }
    }
    return { tag, start: index, length, end: index + length };
  }

  function bigintFromBytes(bytes) {
    let hex = "";
    for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
    return BigInt(`0x${hex || "0"}`);
  }

  function bigintToBytes(value, length = 0) {
    let hex = value.toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    if (length > 0) hex = hex.padStart(length * 2, "0");
    const result = new Uint8Array(hex.length / 2);
    for (let index = 0; index < result.length; index += 1) {
      result[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    return result;
  }

  function modPow(base, exponent, modulus) {
    let result = 1n;
    let factor = base % modulus;
    let power = exponent;
    while (power > 0n) {
      if (power & 1n) result = (result * factor) % modulus;
      factor = (factor * factor) % modulus;
      power >>= 1n;
    }
    return result;
  }

  let bykcPublicKey = null;
  function bykcRsaKey() {
    if (bykcPublicKey) return bykcPublicKey;
    const der = base64ToBytes(BYKC_RSA_PUBLIC_KEY);
    const outer = derRead(der, 0, der.length);
    const algorithm = derRead(der, outer.start, outer.end);
    const bitString = derRead(
      der,
      algorithm.end,
      outer.end
    );
    const bitStart = bitString.start + 1;
    const rsaSequence = derRead(der, bitStart, bitString.end);
    const modulusNode = derRead(der, rsaSequence.start, rsaSequence.end);
    const exponentNode = derRead(
      der,
      modulusNode.end,
      rsaSequence.end
    );
    const modulus = bigintFromBytes(
      der.subarray(modulusNode.start, modulusNode.end)
    );
    const exponent = bigintFromBytes(
      der.subarray(exponentNode.start, exponentNode.end)
    );
    bykcPublicKey = { modulus, exponent, size: Math.ceil(modulus.toString(2).length / 8) };
    return bykcPublicKey;
  }

  function bykcRsaEncrypt(bytes) {
    const key = bykcRsaKey();
    if (bytes.length > key.size - 11) throw new Error("博雅 RSA 数据过长");
    const paddingLength = key.size - bytes.length - 3;
    const padding = new Uint8Array(paddingLength);
    const random = new Uint8Array(paddingLength * 2);
    crypto.getRandomValues(random);
    let sourceIndex = 0;
    for (let index = 0; index < paddingLength; index += 1) {
      let value = 0;
      while (value === 0) {
        if (sourceIndex >= random.length) {
          crypto.getRandomValues(random);
          sourceIndex = 0;
        }
        value = random[sourceIndex++];
      }
      padding[index] = value;
    }
    const encoded = concatBytes(
      Uint8Array.of(0, 2),
      padding,
      Uint8Array.of(0),
      bytes
    );
    const encrypted = modPow(
      bigintFromBytes(encoded),
      key.exponent,
      key.modulus
    );
    return bytesToBase64(bigintToBytes(encrypted, key.size));
  }

  function bykcPkcs7(data) {
    const padding = 16 - (data.length % 16);
    const result = new Uint8Array(data.length + padding);
    result.set(data);
    result.fill(padding, data.length);
    return result;
  }

  function aesMultiply(left, right) {
    let result = 0;
    let a = left;
    let b = right;
    for (let index = 0; index < 8; index += 1) {
      if (b & 1) result ^= a;
      const high = a & 0x80;
      a = (a << 1) & 0xff;
      if (high) a ^= 0x1b;
      b >>= 1;
    }
    return result;
  }

  function aesPow(value, exponent) {
    let result = 1;
    let factor = value;
    let power = exponent;
    while (power > 0) {
      if (power & 1) result = aesMultiply(result, factor);
      factor = aesMultiply(factor, factor);
      power >>= 1;
    }
    return result;
  }

  function rotateByte(value, count) {
    return ((value << count) | (value >>> (8 - count))) & 0xff;
  }

  const AES_SBOX = new Uint8Array(256);
  const AES_INV_SBOX = new Uint8Array(256);
  for (let index = 0; index < 256; index += 1) {
    const inverse = index === 0 ? 0 : aesPow(index, 254);
    const substituted =
      inverse ^
      rotateByte(inverse, 1) ^
      rotateByte(inverse, 2) ^
      rotateByte(inverse, 3) ^
      rotateByte(inverse, 4) ^
      0x63;
    AES_SBOX[index] = substituted;
    AES_INV_SBOX[substituted] = index;
  }

  function aesKeyExpansion(keyBytes) {
    const words = [];
    for (let index = 0; index < 4; index += 1) {
      words.push(Array.from(keyBytes.subarray(index * 4, index * 4 + 4)));
    }
    let rcon = 1;
    for (let index = 4; index < 44; index += 1) {
      let temp = words[index - 1].slice();
      if (index % 4 === 0) {
        temp = [
          AES_SBOX[temp[1]],
          AES_SBOX[temp[2]],
          AES_SBOX[temp[3]],
          AES_SBOX[temp[0]],
        ];
        temp[0] ^= rcon;
        rcon = aesMultiply(rcon, 2);
      }
      words.push(
        words[index - 4].map((value, offset) => value ^ temp[offset])
      );
    }
    const roundKeys = [];
    for (let round = 0; round < 11; round += 1) {
      roundKeys.push(
        Uint8Array.from(
          words
            .slice(round * 4, round * 4 + 4)
            .flat()
        )
      );
    }
    return roundKeys;
  }

  function aesAddRoundKey(state, key) {
    for (let index = 0; index < 16; index += 1) {
      state[index] ^= key[index];
    }
  }

  function aesSubBytes(state) {
    for (let index = 0; index < 16; index += 1) {
      state[index] = AES_SBOX[state[index]];
    }
  }

  function aesInvSubBytes(state) {
    for (let index = 0; index < 16; index += 1) {
      state[index] = AES_INV_SBOX[state[index]];
    }
  }

  function aesShiftRows(state) {
    const copy = state.slice();
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        state[row + 4 * column] =
          copy[row + 4 * ((column + row) % 4)];
      }
    }
  }

  function aesInvShiftRows(state) {
    const copy = state.slice();
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        state[row + 4 * column] =
          copy[row + 4 * ((column - row + 4) % 4)];
      }
    }
  }

  function aesMixColumns(state) {
    for (let column = 0; column < 4; column += 1) {
      const offset = column * 4;
      const a = state[offset];
      const b = state[offset + 1];
      const c = state[offset + 2];
      const d = state[offset + 3];
      state[offset] = aesMultiply(a, 2) ^ aesMultiply(b, 3) ^ c ^ d;
      state[offset + 1] = a ^ aesMultiply(b, 2) ^ aesMultiply(c, 3) ^ d;
      state[offset + 2] = a ^ b ^ aesMultiply(c, 2) ^ aesMultiply(d, 3);
      state[offset + 3] = aesMultiply(a, 3) ^ b ^ c ^ aesMultiply(d, 2);
    }
  }

  function aesInvMixColumns(state) {
    for (let column = 0; column < 4; column += 1) {
      const offset = column * 4;
      const a = state[offset];
      const b = state[offset + 1];
      const c = state[offset + 2];
      const d = state[offset + 3];
      state[offset] =
        aesMultiply(a, 14) ^
        aesMultiply(b, 11) ^
        aesMultiply(c, 13) ^
        aesMultiply(d, 9);
      state[offset + 1] =
        aesMultiply(a, 9) ^
        aesMultiply(b, 14) ^
        aesMultiply(c, 11) ^
        aesMultiply(d, 13);
      state[offset + 2] =
        aesMultiply(a, 13) ^
        aesMultiply(b, 9) ^
        aesMultiply(c, 14) ^
        aesMultiply(d, 11);
      state[offset + 3] =
        aesMultiply(a, 11) ^
        aesMultiply(b, 13) ^
        aesMultiply(c, 9) ^
        aesMultiply(d, 14);
    }
  }

  function aesEncryptBlock(block, roundKeys) {
    const state = Array.from(block);
    aesAddRoundKey(state, roundKeys[0]);
    for (let round = 1; round <= 9; round += 1) {
      aesSubBytes(state);
      aesShiftRows(state);
      aesMixColumns(state);
      aesAddRoundKey(state, roundKeys[round]);
    }
    aesSubBytes(state);
    aesShiftRows(state);
    aesAddRoundKey(state, roundKeys[10]);
    return Uint8Array.from(state);
  }

  function aesDecryptBlock(block, roundKeys) {
    const state = Array.from(block);
    aesAddRoundKey(state, roundKeys[10]);
    for (let round = 9; round >= 1; round -= 1) {
      aesInvShiftRows(state);
      aesInvSubBytes(state);
      aesAddRoundKey(state, roundKeys[round]);
      aesInvMixColumns(state);
    }
    aesInvShiftRows(state);
    aesInvSubBytes(state);
    aesAddRoundKey(state, roundKeys[0]);
    return Uint8Array.from(state);
  }

  async function bykcAesEncrypt(data, keyBytes) {
    const padded = bykcPkcs7(data);
    const roundKeys = aesKeyExpansion(keyBytes);
    const chunks = [];
    for (let offset = 0; offset < padded.length; offset += 16) {
      chunks.push(
        aesEncryptBlock(padded.subarray(offset, offset + 16), roundKeys)
      );
    }
    return concatBytes(...chunks);
  }

  async function bykcAesDecrypt(data, keyBytes) {
    if (!data.length || data.length % 16 !== 0) {
      throw new Error("博雅 AES 数据长度错误");
    }
    const roundKeys = aesKeyExpansion(keyBytes);
    const chunks = [];
    for (let offset = 0; offset < data.length; offset += 16) {
      chunks.push(
        aesDecryptBlock(data.subarray(offset, offset + 16), roundKeys)
      );
    }
    const result = concatBytes(...chunks);
    const padding = result[result.length - 1];
    if (padding < 1 || padding > 16) {
      throw new Error("博雅 AES 填充无效");
    }
    for (let index = result.length - padding; index < result.length; index += 1) {
      if (result[index] !== padding) {
        throw new Error("博雅 AES 填充无效");
      }
    }
    return new TextDecoder().decode(
      result.subarray(0, result.length - padding)
    );
  }

  function sha1Hex(bytes) {
    return crypto.subtle.digest("SHA-1", bytes).then(digest => {
      let result = "";
      for (const byte of new Uint8Array(digest)) {
        result += byte.toString(16).padStart(2, "0");
      }
      return result;
    });
  }

  async function collectBykc() {
    reportProgress("博雅课程：正在读取登录会话");
    const readToken = () => {
      const currentUrl = new URL(location.href);
      return (
        currentUrl.searchParams.get("token") ||
        sessionStorage.getItem("buaa_bykc_token") ||
        bykcAngularToken() ||
        findStoredToken([
          "bykc_token",
          "_token",
          "auth_token",
          "authtoken",
          "token",
        ]) ||
        ""
      );
    };
    const token = await waitForValue(readToken, 6000, 250);
    if (!token) {
      const error = new Error("请先完成博雅课程官方登录");
      error.needLogin = true;
      throw error;
    }
    sessionStorage.setItem("buaa_bykc_token", token);
    reportProgress("博雅课程：正在读取课程与签到状态");
    const call = async (apiName, requestData) => {
      const plain = JSON.stringify(requestData || {});
      const dataBytes = utf8(plain);
      const aesKeyText = Array.from(
        crypto.getRandomValues(new Uint8Array(16)),
        byte => BYKC_KEY_CHARS[byte % BYKC_KEY_CHARS.length]
      ).join("");
      const aesKey = utf8(aesKeyText);
      const encryptedData = await bykcAesEncrypt(dataBytes, aesKey);
      const sha = await sha1Hex(dataBytes);
      const { response, body } = await withReadRetry("博雅接口", () =>
        fetchText(
          upstreamUrl(`https://bykc.buaa.edu.cn/sscv/${apiName}`),
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json; charset=UTF-8",
              auth_token: token,
              authtoken: token,
              ak: bykcRsaEncrypt(aesKey),
              sk: bykcRsaEncrypt(utf8(sha)),
              ts: String(Date.now()),
            },
            body: bytesToBase64(encryptedData),
          }
        )
      );
      if (looksLikeLoginResponse(response, body)) {
        const error = new Error("博雅登录状态已失效");
        error.needLogin = true;
        throw error;
      }
      if (!response.ok) throw new Error(`博雅 HTTP ${response.status}`);
      let raw = body;
      const quoted = parseJson(body, null);
      if (typeof quoted === "string") raw = quoted;
      let decoded = raw;
      try {
        decoded = await bykcAesDecrypt(base64ToBytes(raw), aesKey);
      } catch {}
      const payload = object(parseJson(decoded, decoded));
      if (payload.status !== "0") {
        const error = new Error(
          text(payload.errmsg || payload.msg, "博雅请求失败")
        );
        error.needLogin = /登录|会话|失效/.test(error.message);
        throw error;
      }
      return payload.data;
    };
    const config = object(await call("getAllConfig", {}));
    const semesters = array(config.semester);
    const now = Date.now();
    const currentSemester =
      semesters.find(item => {
        const start = new Date(item.semesterStartDate).getTime();
        const end = new Date(item.semesterEndDate).getTime();
        return Number.isFinite(start) &&
          Number.isFinite(end) &&
          now >= start &&
          now <= end;
      }) ||
      semesters
        .slice()
        .sort(
          (left, right) =>
            new Date(right.semesterEndDate).getTime() -
            new Date(left.semesterEndDate).getTime()
        )[0];
    if (!currentSemester) throw new Error("未取得博雅当前学期");
    let selected = [];
    if (
      currentSemester.semesterStartDate &&
      currentSemester.semesterEndDate
    ) {
      const chosen = object(
        await call("queryChosenCourse", {
          startDate: currentSemester.semesterStartDate,
          endDate: currentSemester.semesterEndDate,
        })
      );
      selected = array(chosen.courseList).map(item => {
        const course = object(item.courseInfo);
        return {
          id: text(course.id || item.id),
          chosenId: text(item.id),
          courseName: text(course.courseName, "未命名博雅课程"),
          courseTeacher: text(course.courseTeacher),
          coursePosition: text(course.coursePosition),
          courseStartDate: text(course.courseStartDate),
          courseEndDate: text(course.courseEndDate),
          selectStart: text(course.courseSelectStartDate),
          selectEnd: text(course.courseSelectEndDate),
          checkin: number(item.checkin, 0),
          pass: number(item.pass, 0),
          statusName:
            number(item.checkin, 0) > 0 ? "已签到" : "未签到",
          signInfo: text(item.signInfo),
        };
      });
    }
    let courses = [];
    if (!selected.length) {
      reportProgress("博雅课程：正在补充可选课程列表");
      const page = object(
        await call("queryStudentSemesterCourseByPage", {
          pageNumber: 1,
          pageSize: 50,
        })
      );
      courses = array(page.content).map(item => ({
        id: text(item.id),
        courseName: text(item.courseName, "未命名博雅课程"),
        courseTeacher: text(item.courseTeacher),
        coursePosition: text(item.coursePosition),
        selectStart: text(item.courseSelectStartDate),
        selectEnd: text(item.courseSelectEndDate),
        currentCount: number(item.courseCurrentCount),
        maxCount: number(item.courseMaxCount),
        selected: Boolean(item.selected),
      }));
    }
    reportProgress("博雅课程：同步完成");
    return {
      semesterName: text(currentSemester.semesterName),
      selected,
      courses: selected.length ? selected : courses,
      attendance: selected
        .filter(item => item.checkin > 0 && item.signInfo)
        .map(item => ({
          courseName: item.courseName,
          checkin: item.checkin,
          note: item.signInfo,
        })),
      updatedAt: new Date().toISOString(),
    };
  }

  async function collectHomework() {
    const result = await collectSpoc();
    return {
      ...result,
      assignments: array(result.assignments).map(item => ({
        ...object(item),
        source: "北航作业库",
      })),
    };
  }

  window.BUAASources = Object.freeze({
    collectSpoc: () => safeCollect(collectSpoc),
    collectHomework: () => safeCollect(collectHomework),
    collectJudge: () => safeCollect(collectJudge),
    collectLibrary: () => safeCollect(collectLibrary),
    collectBykc: () => safeCollect(collectBykc),
  });
})();
