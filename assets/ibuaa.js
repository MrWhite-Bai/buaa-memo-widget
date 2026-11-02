(() => {
  "use strict";

  const STORAGE_KEY = "buaa_ibuaa_cache_v1";
  const RECORDS_KEY_PREFIX = "buaa_memo_records_v2";
  const OFFICIAL = Object.freeze({
    byxt: "https://byxt.buaa.edu.cn/jwapp/sys/byrhmhsy/index.do",
    score: "https://app.buaa.edu.cn/buaascore/wap/default/index",
    homework: "https://spoc.buaa.edu.cn/spocnew/",
    library: "https://booking.lib.buaa.edu.cn/h5/",
    bykc: "https://bykc.buaa.edu.cn/sscv/",
  });

  const page = document.getElementById("ibuaaPage");
  const tab = document.getElementById("iBuaaTabBtn");
  if (!page || !tab) return;

  const onlineChip = document.getElementById("iBuaaOnlineChip");
  const onlineLabel = document.getElementById("iBuaaOnlineLabel");
  const statusTitle = document.getElementById("iBuaaStatusTitle");
  const statusDetail = document.getElementById("iBuaaStatusDetail");
  const loginButton = document.getElementById("iBuaaLoginBtn");
  const refreshButton = document.getElementById("iBuaaRefreshBtn");
  const nextClassTitle = document.getElementById("iBuaaNextClassTitle");
  const nextClassCopy = document.getElementById("iBuaaNextClassCopy");
  const todaySchedule = document.getElementById("iBuaaTodaySchedule");
  const examSummary = document.getElementById("iBuaaExamSummary");
  const assignmentSummary = document.getElementById("iBuaaAssignmentSummary");
  const academicSummary = document.getElementById("iBuaaAcademicSummary");
  const librarySummary = document.getElementById("iBuaaLibrarySummary");
  const bykcSummary = document.getElementById("iBuaaBykcSummary");

  let refreshPending = false;
  let refreshWatchdog = 0;
  let lastRenderedMinute = "";
  let activeDetail = "";
  let state = readState();
  let nextCourse = null;

  function parseJson(value, fallback) {
    if (value && typeof value === "object") return value;
    try {
      return JSON.parse(String(value || ""));
    } catch {
      return fallback;
    }
  }

  function text(value, fallback = "") {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function object(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function readState() {
    const stored = parseJson(localStorage.getItem(STORAGE_KEY), {});
    return {
      version: 1,
      updatedAt: text(stored.updatedAt),
      source: text(stored.source, "local"),
      online: Boolean(stored.online),
      accountKey: text(stored.accountKey),
      syncVersion: number(stored.syncVersion),
      termCode: text(stored.termCode),
      termName: text(stored.termName),
      calendar: object(stored.calendar),
      exams: array(stored.exams),
      assignments: array(stored.assignments),
      academics: object(stored.academics),
      library: object(stored.library),
      bykc: object(stored.bykc),
      signin: object(stored.signin),
      sourceErrors: object(stored.sourceErrors),
    };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }

  function readRecords() {
    const recordsById = new Map();
    const anonymous = [];
    const ingest = records => {
      if (!Array.isArray(records)) return;
      for (const record of records) {
        if (!record || typeof record !== "object") continue;
        if (!record.id) {
          anonymous.push(record);
          continue;
        }
        const previous = recordsById.get(String(record.id));
        const previousStamp = text(
          previous?.updated_at || previous?.updatedAt || previous?.created_at
        );
        const recordStamp = text(
          record.updated_at || record.updatedAt || record.created_at
        );
        if (!previous || recordStamp >= previousStamp) {
          recordsById.set(String(record.id), record);
        }
      }
    };
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(RECORDS_KEY_PREFIX)) continue;
      const records = parseJson(localStorage.getItem(key), []);
      ingest(records);
    }
    try {
      const nativeRecords =
        window.AndroidMemo?.readRecords?.() ||
        window.BUAADesktopBridge?.readRecords?.();
      if (nativeRecords) ingest(parseJson(nativeRecords, []));
    } catch {
      // Keep browser-local records available if the native store is busy.
    }
    return [...recordsById.values(), ...anonymous];
  }

  function isCourseRecord(record) {
    return (
      record &&
      (record.item_type === "course" ||
        record.schedule_import === "buaa" ||
        record.schedule_import === "manual-course")
    );
  }

  function localDateValue(date) {
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}`;
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function formatDate(value, includeTime = false) {
    const date = parseDate(value);
    if (!date) return text(value, "时间待定");
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      ...(includeTime
        ? { hour: "2-digit", minute: "2-digit", hour12: false }
        : {}),
    });
  }

  function formatClock(value) {
    const date = parseDate(value);
    if (!date) return "--:--";
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function relativeFreshness(updatedAt) {
    const date = parseDate(updatedAt);
    if (!date) return "尚未同步";
    const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (seconds < 30) return "刚刚更新";
    if (seconds < 60) return `${seconds} 秒前更新`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前更新`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前更新`;
    return `${Math.floor(seconds / 86400)} 天前更新`;
  }

  function normalizeExam(raw) {
    const item = object(raw);
    const dateText = text(
      item.date ||
        item.examDate ||
        item.startDate ||
        item.exam_date ||
        item.ksrq
    );
    const timeText = text(
      item.time ||
        item.examTime ||
        item.startTime ||
        item.exam_time ||
        item.kssj
    );
    let startAt = text(item.startAt || item.start_at || item.start);
    if (!startAt && dateText) {
      startAt =
        dateText.includes("T") || /\d{1,2}:\d{2}/.test(dateText)
          ? dateText
          : `${dateText}T${timeText || "00:00"}`;
    }
    return {
      id: text(item.id || item.examId || item.code, `${dateText}-${text(item.name)}`),
      name: text(
        item.name ||
          item.examName ||
          item.courseName ||
          item.title ||
          item.kcmc,
        "未命名考试"
      ),
      startAt,
      timeText,
      location: text(
        item.location ||
          item.place ||
          item.classroom ||
          item.room ||
          item.ksdd,
        "地点待定"
      ),
      seat: text(item.seat || item.seatNo || item.seat_no || item.zwh, "座位待定"),
    };
  }

  function normalizeAssignment(raw, sourceFallback) {
    const item = object(raw);
    return {
      id: text(item.id || item.assignmentId || item.zyid || item.title),
      title: text(
        item.title || item.name || item.assignmentName || item.zymc,
        "未命名作业"
      ),
      courseName: text(
        item.courseName || item.course || item.kcmc,
        "课程待定"
      ),
      dueAt: text(
        item.dueAt ||
          item.dueTime ||
          item.deadline ||
          item.endTime ||
          item.zyjzsj
      ),
      status: text(item.status || item.submitStatus || item.tjzt, "状态待同步"),
      source: text(item.source || sourceFallback, "作业系统"),
    };
  }

  function normalizeGrade(raw) {
    const item = object(raw);
    return {
      title: text(
        item.title ||
          item.courseName ||
          item.course ||
          item.name ||
          item.kcmc,
        "未命名课程"
      ),
      score: text(item.score || item.grade || item.cj, "未公布"),
      credit: text(item.credit || item.credits || item.xf, ""),
      gpa: text(item.gpa || item.gradePoint || item.jd, ""),
      passed: item.passed !== undefined
        ? Boolean(item.passed)
        : !/不及格|未通过|fail/i.test(
            text(item.score || item.grade || item.cj)
          ),
    };
  }

  function toDateOnly(value) {
    const date = parseDate(value);
    return date ? localDateValue(date) : "";
  }

  function currentTermCalendar(rawTerms) {
    const terms = array(rawTerms).map(object);
    const selected =
      terms.find(item => item.selected) ||
      terms.find(item => text(item.itemCode || item.termCode) === state.termCode) ||
      terms[0] ||
      {};
    const start =
      selected.itemStartDate ||
      selected.startDate ||
      selected.start_at ||
      selected.termStart ||
      "";
    const end =
      selected.itemEndDate ||
      selected.endDate ||
      selected.end_at ||
      selected.termEnd ||
      "";
    return {
      schoolStart: toDateOnly(start),
      schoolEnd: toDateOnly(end),
      examWeeks: text(
        state.calendar.examWeeks ||
          selected.examWeeks ||
          selected.examWeek ||
          ""
      ),
      holidays: text(
        state.calendar.holidays ||
          selected.holidays ||
          selected.holiday ||
          ""
      ),
      makeupDays: text(
        state.calendar.makeupDays ||
          selected.makeupDays ||
          selected.makeupDay ||
          ""
      ),
      source: "北航校历与教务学期",
    };
  }

  function mergeOfficialPayload(payload, source = "native") {
    const root = object(parseJson(payload, payload));
    const snapshot = object(root.ibuaa || root.snapshot || root);
    let current = readState();
    const incomingAccountKey = text(
      snapshot.accountKey ||
        snapshot.studentId ||
        snapshot.studentNo ||
        root.accountKey ||
        root.studentId ||
        root.studentNo
    );
    if (
      incomingAccountKey &&
      current.accountKey &&
      incomingAccountKey !== current.accountKey
    ) {
      current = {
        ...readState(),
        exams: [],
        assignments: [],
        academics: {},
        library: {},
        bykc: {},
        signin: {},
      };
    }
    const terms = array(
      snapshot.terms || root.terms || root.termList || root.schoolCalendars
    );
    const weeks = array(snapshot.weeks || root.weeks).slice().sort(
      (left, right) =>
        number(left.serialNumber || left.week, 9999) -
        number(right.serialNumber || right.week, 9999)
    );
    const firstWeekDate = toDateOnly(
      weeks[0]?.startDate || weeks[0]?.beginDate || weeks[0]?.date
    );
    const lastWeek = weeks[weeks.length - 1];
    const lastWeekStart = toDateOnly(
      lastWeek?.startDate || lastWeek?.beginDate || lastWeek?.date
    );
    const lastWeekDate = parseDate(lastWeekStart);
    if (lastWeekDate) lastWeekDate.setDate(lastWeekDate.getDate() + 6);
    const examSource = array(
      snapshot.exams || root.exams || root.examArrangement || root.examList
    );
    const assignments = [
      ...array(snapshot.assignments),
      ...array(root.assignments),
      ...array(snapshot.homeworkAssignments).map(item =>
        normalizeAssignment(item, "北航作业库")
      ),
    ].map((item, index) => {
      const normalized = normalizeAssignment(item, "作业系统");
      if (!normalized.id) normalized.id = `assignment-${index}`;
      return normalized;
    });
    const academicSnapshot = object(snapshot.academics || root.academics);
    const gradeRows = array(
      academicSnapshot.grades || snapshot.grades || root.grades
    ).map(normalizeGrade);
    const librarySnapshot = object(snapshot.library || root.library);
    const bykcSnapshot = object(snapshot.bykc || root.bykc);
    state = {
      ...current,
      updatedAt: new Date().toISOString(),
      source,
      online: true,
      accountKey: incomingAccountKey || current.accountKey,
      syncVersion: number(
        root.ibuaaSyncVersion || snapshot.ibuaaSyncVersion,
        current.syncVersion
      ),
      termCode: text(
        snapshot.termCode ||
          root.termCode ||
          current.termCode,
        current.termCode
      ),
      termName: text(
        snapshot.termName ||
          root.termName ||
          current.termName
      ),
      calendar: {
        ...currentTermCalendar(terms),
        ...(firstWeekDate && !current.calendar.schoolStart
          ? { schoolStart: firstWeekDate }
          : {}),
        ...(lastWeekDate && !current.calendar.schoolEnd
          ? { schoolEnd: localDateValue(lastWeekDate) }
          : {}),
        ...object(snapshot.calendar),
        ...object(root.calendar),
      },
      exams: examSource.length
        ? examSource.map(normalizeExam)
        : current.exams,
      assignments: assignments.length
        ? assignments
        : current.assignments,
      academics: Object.keys(academicSnapshot).length
        ? {
            ...current.academics,
            ...academicSnapshot,
            gpa: text(
              academicSnapshot.gpa ||
                academicSnapshot.averageGpa ||
                current.academics.gpa
            ),
            credits: number(
              academicSnapshot.credits ||
                academicSnapshot.earnedCredits ||
                current.academics.credits
            ),
            requiredCredits: number(
              academicSnapshot.requiredCredits ||
                current.academics.requiredCredits
            ),
            passed: number(
              academicSnapshot.passed ||
                academicSnapshot.passedCourses ||
                current.academics.passed
            ),
            total: number(
              academicSnapshot.total ||
                academicSnapshot.totalCourses ||
                current.academics.total
            ),
            grades: gradeRows.length ? gradeRows : array(current.academics.grades),
          }
        : gradeRows.length
          ? { ...current.academics, grades: gradeRows }
          : current.academics,
      library: Object.keys(librarySnapshot).length
        ? { ...current.library, ...librarySnapshot }
        : current.library,
      bykc: Object.keys(bykcSnapshot).length
        ? { ...current.bykc, ...bykcSnapshot }
        : current.bykc,
      signin: {
        ...current.signin,
        ...object(snapshot.signin),
      },
      sourceErrors: {
        ...current.sourceErrors,
        ...object(root.sourceErrors || snapshot.sourceErrors),
      },
    };
    saveState();
    render();
  }

  function deriveLocalSchedule() {
    const records = readRecords().filter(
      record => !record.deleted && isCourseRecord(record)
    );
    const today = localDateValue(new Date());
    const courses = records
      .map(record => {
        const start = parseDate(
          record.start_at || record.schedule_start_at || record.course_start_at
        );
        const end = parseDate(
          record.deadline || record.schedule_end_at || record.course_end_at
        );
        if (!start) return null;
        return {
          id: text(
            record.schedule_source_key ||
              record.schedule_course_code ||
              record.id
          ),
          title: text(
            record.schedule_course_name || record.title,
            "未命名课程"
          ),
          location: text(record.location || record.schedule_location, "地点待定"),
          start,
          end,
          sameDay: localDateValue(start) === today,
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.start - right.start);
    return courses;
  }

  function nextCourseState(courses = deriveLocalSchedule()) {
    const now = Date.now();
    const current = courses.find(
      item =>
        item.end &&
        item.start.getTime() <= now &&
        item.end.getTime() >= now
    );
    if (current) return current;
    return courses.find(item => item.start.getTime() >= now) || null;
  }

  function updateNextClass() {
    const courses = deriveLocalSchedule();
    const todayCourses = courses.filter(item => item.sameDay);
    nextCourse = nextCourseState(courses);
    renderTodaySchedule(todayCourses, nextCourse);
    if (!nextCourse) {
      nextClassTitle.textContent = todayCourses.length
        ? "今日课程已结束"
        : "暂无课程";
      nextClassCopy.textContent =
        todayCourses.length
          ? `今天共 ${todayCourses.length} 节课。`
          : "同步课表后可查看今日课程。";
      return;
    }
    nextClassTitle.textContent = nextCourse.title;
    const datePrefix = nextCourse.sameDay
      ? ""
      : `${formatDate(nextCourse.start)} · `;
    nextClassCopy.textContent =
      `${datePrefix}${formatClock(nextCourse.start)}–${formatClock(nextCourse.end)} · ` +
      `${nextCourse.location}`;
  }

  function renderTodaySchedule(courses, nextCourse) {
    if (!todaySchedule) return;
    todaySchedule.replaceChildren();
    if (!courses.length) {
      const empty = document.createElement("span");
      empty.className = "ibuaa-today-empty";
      empty.textContent = "今天没有课程安排";
      todaySchedule.appendChild(empty);
      return;
    }
    const now = Date.now();
    for (const course of courses) {
      const row = document.createElement("div");
      row.className = "ibuaa-today-course";
      if (course.id === nextCourse?.id) row.classList.add("next");
      if (course.start.getTime() <= now && course.end?.getTime() >= now) {
        row.classList.add("current");
      } else if (course.end?.getTime() < now) {
        row.classList.add("past");
      }
      const time = document.createElement("span");
      time.className = "ibuaa-today-course-time";
      time.textContent = `${formatClock(course.start)}-${formatClock(course.end)}`;
      const copy = document.createElement("span");
      copy.className = "ibuaa-today-course-copy";
      const title = document.createElement("strong");
      title.textContent = course.title;
      const detail = document.createElement("small");
      detail.textContent = [
        course.location,
        row.classList.contains("current")
          ? "进行中"
          : row.classList.contains("next")
            ? "下一节"
            : row.classList.contains("past")
              ? "已结束"
              : "",
      ]
        .filter(Boolean)
        .join(" · ");
      copy.append(title, detail);
      row.append(time, copy);
      todaySchedule.appendChild(row);
    }
  }

  function upcomingExams() {
    return state.exams
      .slice()
      .sort(
        (left, right) =>
          (parseDate(left.startAt)?.getTime() || Number.MAX_SAFE_INTEGER) -
          (parseDate(right.startAt)?.getTime() || Number.MAX_SAFE_INTEGER)
      );
  }

  function upcomingAssignments() {
    return state.assignments
      .slice()
      .sort(
        (left, right) =>
          (parseDate(left.dueAt)?.getTime() || Number.MAX_SAFE_INTEGER) -
          (parseDate(right.dueAt)?.getTime() || Number.MAX_SAFE_INTEGER)
      );
  }

  function renderStatus() {
    const chipState =
      refreshPending ? "loading" : state.online ? "online" : state.updatedAt ? "error" : "idle";
    onlineChip.dataset.state = chipState;
    onlineLabel.textContent = refreshPending
      ? "正在更新"
      : state.online
        ? "官网在线"
        : state.updatedAt
          ? "本地缓存"
          : "等待更新";
    if (refreshPending) {
      statusTitle.textContent = "正在等待北航官方登录";
      statusDetail.textContent =
        "完成登录后会自动同步 i北航；90 秒无结果会自动结束等待";
    } else if (state.online) {
      statusTitle.textContent = "北航官网状态已更新";
      const errorCount = Object.keys(object(state.sourceErrors)).length;
      statusDetail.textContent =
        `${relativeFreshness(state.updatedAt)} · ${
          state.termName || "当前学期"
        }${errorCount ? ` · ${errorCount} 个模块未完成` : ""}`;
    } else if (state.updatedAt) {
      statusTitle.textContent = "当前显示本机缓存";
      statusDetail.textContent = `${relativeFreshness(
        state.updatedAt
      )} · 点击“登录”同步官网；刷新只读取本机缓存`;
    } else {
      statusTitle.textContent = "尚未同步北航官网";
      statusDetail.textContent =
        "请先点击“登录”，完成北航官网认证后再同步";
    }
    refreshButton.disabled = refreshPending;
    refreshButton.textContent = refreshPending ? "同步中…" : "刷新缓存";
    if (loginButton) {
      loginButton.disabled = refreshPending;
      loginButton.textContent = refreshPending
        ? "登录中…"
        : state.online
          ? "重新登录"
          : "登录";
    }
  }

  function renderModuleSummaries() {
    const exams = upcomingExams();
    examSummary.textContent = exams.length
      ? `${exams.length} 场 · ${text(exams[0].name, "下一场")}`
      : "尚未同步";
    assignmentSummary.textContent = "打开官方作业库";
    const academics = object(state.academics);
    const gpa = text(academics.gpa);
    const credits = number(academics.credits, 0);
    academicSummary.textContent = gpa || credits
      ? [gpa ? `GPA ${gpa}` : "", credits ? `${credits} 学分` : ""]
          .filter(Boolean)
          .join(" · ")
      : "尚未同步";
    librarySummary.textContent = "打开图书馆系统";
    const bykc = object(state.bykc);
    const selected = array(bykc.selected || bykc.courses).length;
    bykcSummary.textContent = selected
      ? `${selected} 门已选`
      : state.sourceErrors["博雅课程"]
        ? "同步失败"
        : "官方入口";
  }

  function render() {
    renderStatus();
    renderModuleSummaries();
    updateNextClass();
    lastRenderedMinute = new Date().toISOString().slice(0, 16);
  }

  function openExternal(url) {
    const target = String(url || "").trim();
    if (!target) return;
    if (window.BUAADesktopBridge?.openUrl) {
      window.BUAADesktopBridge.openUrl(target);
      return;
    }
    const bridge = window.AndroidMemo;
    if (bridge?.openUrl) {
      bridge.openUrl(target);
      return;
    }
    window.open(target, "_blank", "noopener");
  }

  function ensureDetailOverlay() {
    let overlay = document.getElementById("iBuaaDetailOverlay");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.id = "iBuaaDetailOverlay";
    overlay.innerHTML = `
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="iBuaaDetailTitle" style="max-width:620px">
        <div class="week-toolbar">
          <h2 id="iBuaaDetailTitle">i北航</h2>
          <button type="button" id="iBuaaDetailCloseBtn">关闭</button>
        </div>
        <p class="form-hint" id="iBuaaDetailLead"></p>
        <div id="iBuaaDetailBody"></div>
      </section>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", event => {
      if (event.target === overlay) closeDetail();
    });
    overlay
      .querySelector("#iBuaaDetailCloseBtn")
      ?.addEventListener("click", closeDetail);
    return overlay;
  }

  function openDetail(title, lead, builder) {
    const overlay = ensureDetailOverlay();
    const titleNode = overlay.querySelector("#iBuaaDetailTitle");
    const leadNode = overlay.querySelector("#iBuaaDetailLead");
    const body = overlay.querySelector("#iBuaaDetailBody");
    titleNode.textContent = title;
    leadNode.textContent = lead;
    body.replaceChildren();
    builder?.(body);
    overlay.classList.add("show");
  }

  function closeDetail() {
    document.getElementById("iBuaaDetailOverlay")?.classList.remove("show");
    activeDetail = "";
  }

  function detailEmpty(container, message) {
    const empty = document.createElement("div");
    empty.className = "ibuaa-empty";
    empty.textContent = message;
    container.appendChild(empty);
  }

  function renderSyncErrors(container, names) {
    const errors = names
      .map(name => [name, text(state.sourceErrors?.[name])])
      .filter(item => item[1]);
    if (!errors.length) return;
    const note = document.createElement("div");
    note.className = "ibuaa-empty";
    note.style.marginBottom = "10px";
    note.textContent = errors
      .map(([name, message]) => `${name}：${message}`)
      .join("\n");
    container.appendChild(note);
  }

  function detailList(container, rows, renderItem) {
    if (!rows.length) {
      detailEmpty(
        container,
        "暂无已同步数据。请先点击“登录”，完成北航官方认证后再同步本人信息。"
      );
      return;
    }
    const list = document.createElement("div");
    list.className = "ibuaa-detail-list";
    rows.forEach(row => {
      const item = document.createElement("div");
      item.className = "ibuaa-detail-item";
      renderItem(item, row);
      list.appendChild(item);
    });
    container.appendChild(list);
  }

  function line(parent, tag, value, className = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    parent.appendChild(node);
    return node;
  }

  function officialButton(container, label, url) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "save";
    button.style.marginTop = "12px";
    button.textContent = label;
    button.addEventListener("click", () => openExternal(url));
    container.appendChild(button);
  }

  function showExams() {
    openDetail(
      "考试安排",
      "只显示本人考试信息；时间、地点与座位号以北航教务处最终发布为准。",
      body => {
        detailList(body, upcomingExams(), (item, exam) => {
          line(item, "strong", exam.name);
          line(
            item,
            "span",
            `${formatDate(exam.startAt, true)} · ${
              exam.timeText || formatClock(exam.startAt)
            }\n${exam.location} · ${exam.seat}`
          );
          line(item, "small", "北航教务 · 本人考试");
        });
        officialButton(body, "打开北航教务", OFFICIAL.byxt);
      }
    );
  }

  function showAssignments() {
    openDetail(
      "北航作业库",
      "从智学北航官网作业库同步作业名称、课程、截止时间与提交状态。",
      body => {
        renderSyncErrors(body, ["作业"]);
        detailList(body, upcomingAssignments(), (item, assignment) => {
          line(item, "strong", assignment.title);
          line(
            item,
            "span",
            `${assignment.courseName}\n截止 ${formatDate(
              assignment.dueAt,
              true
            )} · ${assignment.status}`
          );
          line(item, "small", assignment.source);
        });
        const actions = document.createElement("div");
        actions.className = "sheet-actions";
        const homework = document.createElement("button");
        homework.type = "button";
        homework.className = "save";
        homework.textContent = "打开北航作业库";
        homework.addEventListener("click", () =>
          openExternal(OFFICIAL.homework)
        );
        actions.append(homework);
        body.appendChild(actions);
      }
    );
  }

  function showAcademics() {
    openDetail(
      "学业成绩",
      "成绩、学分与绩点只在本机展示，不会同步给好友或用于公开排名。",
      body => {
        const academics = object(state.academics);
        const summary = document.createElement("div");
        summary.className = "ibuaa-calendar-line";
        [
          ["GPA", text(academics.gpa, "待同步")],
          ["已获学分", text(academics.credits, "待同步")],
          [
            "课程通过",
            academics.passed
              ? `${academics.passed}${academics.total ? ` / ${academics.total}` : ""}`
              : "待同步",
          ],
          [
            "培养要求",
            academics.requiredCredits
              ? `${academics.requiredCredits} 学分`
              : "待同步",
          ],
        ].forEach(([label, value]) => {
          const item = document.createElement("div");
          item.className = "ibuaa-calendar-item";
          line(item, "strong", label);
          line(item, "span", value);
          summary.appendChild(item);
        });
        body.appendChild(summary);
        const rows = array(academics.grades);
        detailList(body, rows, (item, grade) => {
          line(item, "strong", grade.title);
          line(
            item,
            "span",
            `成绩 ${grade.score}${grade.credit ? ` · ${grade.credit} 学分` : ""}${
              grade.gpa ? ` · 绩点 ${grade.gpa}` : ""
            }`
          );
          line(item, "small", grade.passed ? "已通过" : "未通过");
        });
        officialButton(body, "打开成绩查询", OFFICIAL.score);
      }
    );
  }

  function showLibrary() {
    openDetail(
      "图书馆",
      "座位与借阅信息仅用于本人到期提醒。预约、续借和取消操作必须在官方页面确认。",
      body => {
        renderSyncErrors(body, ["图书馆"]);
        const library = object(state.library);
        const sections = [
          ["可用座位", array(library.seats)],
          ["预约记录", array(library.bookings || library.reservations)],
          ["借阅记录", array(library.loans || library.borrowed)],
        ];
        for (const [label, rows] of sections) {
          line(body, "h3", label);
          detailList(body, rows, (item, row) => {
            const value = object(row);
            line(
              item,
              "strong",
              text(value.name || value.title || value.seat || value.bookName, label)
            );
            line(
              item,
              "span",
              text(
                value.note ||
                  value.statusName ||
                  value.dueAt ||
                  value.endTime ||
                  value.location,
                "详情待同步"
              )
            );
          });
        }
        officialButton(body, "打开图书馆座位系统", OFFICIAL.library);
      }
    );
  }

  function showBykc() {
    openDetail(
      "博雅课程",
      "可查看已选课程与开选时间。选课和退课均在官方系统内由本人确认。",
      body => {
        renderSyncErrors(body, ["博雅课程"]);
        const bykc = object(state.bykc);
        const rows = array(bykc.courses || bykc.selected);
        detailList(body, rows, (item, course) => {
          const value = object(course);
          line(
            item,
            "strong",
            text(value.courseName || value.name || value.title, "未命名博雅课程")
          );
          line(
            item,
            "span",
            [
              text(value.coursePosition || value.location),
              text(value.courseTeacher || value.teacher),
              text(value.statusName || value.status),
            ]
              .filter(Boolean)
              .join(" · ") || "详情待同步"
          );
          line(
            item,
            "small",
            text(value.selectStart || value.startAt)
              ? `选课时间 ${formatDate(
                  value.selectStart || value.startAt,
                  true
                )}`
              : "北航博雅系统"
          );
        });
        officialButton(body, "打开博雅课程系统", OFFICIAL.bykc);
      }
    );
  }

  function openModule(moduleName) {
    if (moduleName === "assignments") {
      openExternal(OFFICIAL.homework);
      showToast("已打开北航官网作业库");
      return;
    }
    if (moduleName === "library") {
      openExternal(OFFICIAL.library);
      showToast("已打开图书馆系统");
      return;
    }
    activeDetail = moduleName;
    const opener = {
      exams: showExams,
      assignments: showAssignments,
      academics: showAcademics,
      library: showLibrary,
      bykc: showBykc,
    }[moduleName];
    if (opener) opener();
  }

  function updateFromLocalCache() {
    state = {
      ...state,
      updatedAt: state.updatedAt || new Date().toISOString(),
      source: state.source || "local",
      online: Boolean(state.online),
    };
    saveState();
    render();
  }

  function beginRefresh(forceLogin = false) {
    if (refreshPending) return;
    if (!forceLogin) {
      const wasOnline = Boolean(state.online);
      updateFromLocalCache();
      showToast(
        wasOnline
          ? "已刷新本机缓存的 i北航信息"
          : "请先点击“登录”，完成北航官网认证后再同步"
      );
      return;
    }
    refreshPending = true;
    state = {
      ...state,
      sourceErrors: {},
    };
    saveState();
    window.clearTimeout(refreshWatchdog);
    refreshWatchdog = window.setTimeout(() => {
      if (!refreshPending) return;
      refreshPending = false;
      state = {
        ...state,
        online: false,
      };
      saveState();
      render();
      showToast("等待北航官网超时，请确认登录窗口未被遮挡后重试");
    }, 90 * 1000);
    renderStatus();
    let refreshError = null;
    try {
      const bridge = window.AndroidMemo;
      if (bridge?.refreshIBuaa) {
        try {
          bridge.refreshIBuaa();
          return;
        } catch (error) {
          refreshError = error;
        }
      }
      if (window.BUAADesktopBridge?.refreshIBuaa) {
        try {
          window.BUAADesktopBridge.refreshIBuaa();
          return;
        } catch (error) {
          refreshError = error;
        }
      }
    } catch (error) {
      refreshError = error;
    }
    if (refreshError) {
      const staleNative =
        /method not found|not found|undefined|not a function/i.test(
          String(refreshError?.message || refreshError)
        );
      finishRefresh(
        null,
        staleNative
          ? "当前安装包的原生壳过旧，请安装 v6.0.57 APK 后再登录同步"
          : refreshError?.message || "无法打开北航登录窗口"
      );
      return;
    }
    if (
      window.AndroidMemo?.startScheduleImport ||
      window.BUAADesktopBridge?.startScheduleImport
    ) {
      finishRefresh(
        null,
        "当前安装包只支持课表同步，请安装 v6.0.57 APK 后再同步 i北航"
      );
      return;
    }
    refreshPending = false;
    window.clearTimeout(refreshWatchdog);
    refreshWatchdog = 0;
    openExternal(OFFICIAL.byxt);
    renderStatus();
    showToast("已打开北航官网登录页；网页版登录后可使用原生版同步");
  }

  function finishRefresh(payload, error = "") {
    refreshPending = false;
    window.clearTimeout(refreshWatchdog);
    refreshWatchdog = 0;
    if (error) {
      state = {
        ...state,
        online: false,
        updatedAt: state.updatedAt || new Date().toISOString(),
      };
      saveState();
      render();
      showToast(`北航官网状态更新失败：${error}`);
      return;
    }
    if (payload) {
      mergeOfficialPayload(payload, "native");
      showToast("i北航状态已更新");
      return;
    }
    updateFromLocalCache();
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(
      () => toast.classList.remove("show"),
      2600
    );
  }

  function enter() {
    render();
  }

  function maybeTick() {
    const minute = new Date().toISOString().slice(0, 16);
    if (minute === lastRenderedMinute) return;
    lastRenderedMinute = minute;
    updateNextClass();
    renderStatus();
  }

  function installDesktopNavigation() {
    if (window.BUAA_BOOTSTRAP) return;
    const pages = {
      memos: document.getElementById("memosPage"),
      notes: document.getElementById("notesPage"),
      groups: document.getElementById("groupsPage"),
      ibuaa: page,
      friends: document.getElementById("friendsPage"),
    };
    const tabs = {
      memos: document.getElementById("memosTabBtn"),
      notes: document.getElementById("notesTabBtn"),
      groups: document.getElementById("groupsTabBtn"),
      ibuaa: tab,
      friends: document.getElementById("friendsTabBtn"),
    };
    const activate = name => {
      Object.entries(pages).forEach(([key, node]) => {
        node?.classList.toggle("active", key === name);
      });
      Object.entries(tabs).forEach(([key, node]) => {
        node?.classList.toggle("active", key === name);
      });
      const addButton = document.getElementById("addBtn");
      if (addButton) addButton.hidden = name !== "memos";
      if (name === "ibuaa") enter();
    };
    Object.entries(tabs).forEach(([name, node]) => {
      node?.addEventListener("click", () => activate(name));
    });
  }

  window.BUAAIBuaa = Object.freeze({
    enter,
    leave: () => {
      refreshPending = false;
      window.clearTimeout(refreshWatchdog);
      refreshWatchdog = 0;
      renderStatus();
    },
    refresh: beginRefresh,
    ingest: payload => mergeOfficialPayload(payload, "native"),
    openModule,
  });

  window.BUAANativeIBuaaResult = payload => {
    try {
      finishRefresh(payload);
    } catch (error) {
      finishRefresh(null, error?.message || "数据解析失败");
    }
  };

  window.BUAANativeIBuaaError = message => {
    finishRefresh(null, text(message, "请完成北航官方登录后重试"));
  };

  window.BUAANativeIBuaaCancelled = () => {
    finishRefresh(null);
  };

  window.addEventListener("buaa:ibuaa-data", event => {
    try {
      const parsed = object(parseJson(event.detail, event.detail));
      if (parsed.ok === false || parsed.error) {
        finishRefresh(null, text(parsed.error, "官网状态更新失败"));
        return;
      }
      refreshPending = false;
      window.clearTimeout(refreshWatchdog);
      refreshWatchdog = 0;
      mergeOfficialPayload(event.detail, "native");
    } catch {
      refreshPending = false;
      renderStatus();
    }
  });

  loginButton?.addEventListener("click", () => beginRefresh(true));
  refreshButton?.addEventListener("click", () => beginRefresh(false));
  page.addEventListener("click", event => {
    const module = event.target.closest("[data-ibuaa-module]");
    if (module) openModule(module.dataset.ibuaaModule);
  });

  installDesktopNavigation();
  updateFromLocalCache();
  if (location.hash === "#ibuaa") {
    if (!window.BUAA_BOOTSTRAP) {
      document
        .querySelectorAll(".page")
        .forEach(node => node.classList.toggle("active", node === page));
      document
        .querySelectorAll(".page-nav button")
        .forEach(node => node.classList.toggle("active", node === tab));
    }
    enter();
  }
  window.setInterval(maybeTick, 15000);
})();
