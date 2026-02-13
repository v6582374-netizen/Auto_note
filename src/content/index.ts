(() => {
  const PROTOCOL_VERSION = 1;
  const GLOBAL_KEY = "__musemark_content_ready__";
  const QUICKDOCK_STYLE_ID = "musemark-quickdock-style";

  const win = window as Window & {
    [GLOBAL_KEY]?: boolean;
  };

  if (win[GLOBAL_KEY]) {
    return;
  }
  win[GLOBAL_KEY] = true;

  type OverlayElements = {
    root: HTMLDivElement;
    status: HTMLDivElement;
    summary: HTMLDivElement;
    noteInput: HTMLInputElement;
    categoryBox: HTMLDivElement;
    tagBox: HTMLDivElement;
    saveHint: HTMLDivElement;
  };

  type DockMode = "collapsed" | "peek" | "expanded";

  type DockLayoutState = {
    mode: DockMode;
    pinned: boolean;
    activeProfileId: string;
    updatedAt: string;
  };

  type DockEntry = {
    id: string;
    kind: "bookmark" | "action";
    title: string;
    subtitle?: string;
    url?: string;
    domain?: string;
    favIconUrl?: string;
    pinned?: boolean;
    action?: "open_library" | "save_current_page";
  };

  type DockProfile = {
    id: string;
    name: string;
  };

  type DockStatePayload = {
    enabled: boolean;
    layout: DockLayoutState;
    profiles: DockProfile[];
    pinnedIds: string[];
    entries: DockEntry[];
  };

  type DockElements = {
    root: HTMLDivElement;
    toggle: HTMLButtonElement;
    peek: HTMLDivElement;
    panel: HTMLDivElement;
    list: HTMLDivElement;
    pinButton: HTMLButtonElement;
    collapseButton: HTMLButtonElement;
    libraryButton: HTMLButtonElement;
    saveButton: HTMLButtonElement;
    moreButton: HTMLButtonElement;
    profileLabel: HTMLSpanElement;
  };

  let overlayElements: OverlayElements | null = null;
  let currentSessionId = "";
  let currentBookmarkId = "";
  let selectedCategory = "";
  let selectedTags = new Set<string>();
  let submitting = false;

  let dockElements: DockElements | null = null;
  let dockEnabled = true;
  let dockMode: DockMode = "collapsed";
  let dockPinnedWindow = false;
  let dockEntries: DockEntry[] = [];
  let dockPinnedIds = new Set<string>();
  let dockProfiles: DockProfile[] = [];
  let dockActiveProfileId = "default";
  let dockFocusedIndex = 0;
  let dockSuppressedByOverlay = false;
  let dockRefreshTimer: number | undefined;
  let dockContextMenu: HTMLDivElement | null = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.protocolVersion !== PROTOCOL_VERSION) {
      return false;
    }

    if (message.type === "musemark/startCapture") {
      const payload = message.payload as { sessionId: string; maxChars: number };
      currentSessionId = payload.sessionId;
      selectedCategory = "";
      selectedTags = new Set<string>();
      submitting = false;
      showOverlay("Captured. AI is analyzing...");

      void (async () => {
        const capture = await collectCapturePayload(payload.sessionId, payload.maxChars);
        sendResponse(capture);
      })();
      return true;
    }

    if (message.type === "musemark/bookmarkLinked") {
      const payload = message.payload as { sessionId: string; bookmarkId: string };
      if (payload.sessionId === currentSessionId) {
        currentBookmarkId = payload.bookmarkId;
      }
      return false;
    }

    if (message.type === "musemark/stage1Ready") {
      const payload = message.payload as {
        sessionId: string;
        summary: string;
        suggestedCategoryCandidates: string[];
        suggestedTags: string[];
        textTruncated: boolean;
      };
      if (payload.sessionId === currentSessionId) {
        updateForStage1(payload.summary, payload.suggestedCategoryCandidates, payload.suggestedTags, payload.textTruncated);
      }
      return false;
    }

    if (message.type === "musemark/classifyPending") {
      const payload = message.payload as { sessionId: string };
      if (payload.sessionId === currentSessionId && overlayElements) {
        submitting = false;
        overlayElements.status.textContent = "Classifying and saving...";
      }
      return false;
    }

    if (message.type === "musemark/stageError") {
      const payload = message.payload as { sessionId: string; error: string };
      if (payload.sessionId === currentSessionId && overlayElements) {
        submitting = false;
        overlayElements.status.textContent = "Saved to Inbox with AI error";
        overlayElements.summary.textContent = payload.error;
      }
      return false;
    }

    if (message.type === "musemark/finalized") {
      const payload = message.payload as { sessionId: string; category?: string; tags?: string[] };
      if (payload.sessionId === currentSessionId && overlayElements) {
        submitting = false;
        const category = payload.category || "Uncategorized";
        const tags = (payload.tags ?? []).join(", ");
        overlayElements.status.textContent = `Saved: ${category}${tags ? ` | ${tags}` : ""}`;
        overlayElements.summary.textContent = "Done. Auto closing...";
        window.setTimeout(() => {
          hideOverlay();
          void refreshQuickDock();
        }, 1200);
      }
      return false;
    }

    return false;
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlayElements?.root.style.display !== "none") {
      hideOverlay();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      void toggleDockByShortcut();
      return;
    }

    if (dockMode === "expanded") {
      const isTyping = isTypingTarget(event.target);
      if (event.key === "Escape") {
        event.preventDefault();
        void setDockMode("collapsed", true);
        return;
      }
      if (isTyping) {
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        dockFocusedIndex = Math.min(dockEntries.length - 1, dockFocusedIndex + 1);
        renderDockEntries();
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        dockFocusedIndex = Math.max(0, dockFocusedIndex - 1);
        renderDockEntries();
        return;
      }
      if (event.key === "Enter") {
        if (dockEntries[dockFocusedIndex]) {
          event.preventDefault();
          void openDockEntry(dockEntries[dockFocusedIndex]);
        }
      }
    }
  });

  document.addEventListener("click", () => {
    hideDockContextMenu();
  });

  window.addEventListener("focus", () => {
    void refreshQuickDock();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void refreshQuickDock();
    }
  });

  void initializeQuickDock();

  function ensureOverlay(): OverlayElements {
    if (overlayElements) {
      return overlayElements;
    }

    const root = document.createElement("div");
    root.id = "musemark-overlay";
    root.innerHTML = `
      <div class="musemark-card">
        <div class="musemark-title">MuseMark</div>
        <div class="musemark-status"></div>
        <div class="musemark-summary"></div>
        <div class="musemark-section">
          <div class="musemark-label">Category candidates</div>
          <div class="musemark-category-box"></div>
        </div>
        <div class="musemark-section">
          <div class="musemark-label">Tag candidates</div>
          <div class="musemark-tag-box"></div>
        </div>
        <input class="musemark-input" type="text" maxlength="200" placeholder="One-line note (optional). Press Enter to save..." />
        <div class="musemark-hint">Enter = save now, Esc = close (keeps bookmark in Inbox)</div>
        <div class="musemark-actions">
          <button class="musemark-manager">Open Library</button>
        </div>
      </div>
    `;

    const style = document.createElement("style");
    style.textContent = `
      #musemark-overlay {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        width: min(430px, calc(100vw - 28px));
        font-family: "Avenir Next", "SF Pro Display", "Noto Sans SC", sans-serif;
      }
      #musemark-overlay .musemark-card {
        border-radius: 16px;
        background: linear-gradient(135deg, #101a34 0%, #1d2746 48%, #1f385f 100%);
        color: #f4f8ff;
        border: 1px solid rgba(214, 224, 255, 0.28);
        box-shadow: 0 22px 52px rgba(5, 10, 25, 0.42);
        padding: 14px 14px 12px;
        backdrop-filter: blur(8px);
        animation: musemark-enter 170ms ease-out;
      }
      #musemark-overlay .musemark-title {
        font-weight: 750;
        letter-spacing: 0.2px;
        font-size: 15px;
        margin-bottom: 8px;
      }
      #musemark-overlay .musemark-status {
        font-size: 13px;
        color: #d3e2ff;
      }
      #musemark-overlay .musemark-summary {
        margin-top: 8px;
        font-size: 12px;
        line-height: 1.45;
        color: #d8e6ff;
        max-height: 88px;
        overflow: auto;
        white-space: pre-wrap;
      }
      #musemark-overlay .musemark-section {
        margin-top: 10px;
      }
      #musemark-overlay .musemark-label {
        font-size: 11px;
        color: #a8c5ff;
        margin-bottom: 6px;
      }
      #musemark-overlay .musemark-category-box,
      #musemark-overlay .musemark-tag-box {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      #musemark-overlay .musemark-chip {
        border: 1px solid rgba(190, 212, 255, 0.4);
        background: rgba(23, 46, 79, 0.72);
        color: #eff6ff;
        border-radius: 999px;
        font-size: 11px;
        padding: 4px 9px;
        cursor: pointer;
      }
      #musemark-overlay .musemark-chip.active {
        background: #8bd1ff;
        border-color: #8bd1ff;
        color: #07203a;
      }
      #musemark-overlay .musemark-input {
        width: 100%;
        margin-top: 12px;
        border-radius: 10px;
        border: 1px solid rgba(187, 208, 255, 0.5);
        background: rgba(9, 20, 38, 0.65);
        color: #f3f8ff;
        padding: 9px 10px;
        font-size: 13px;
        outline: none;
      }
      #musemark-overlay .musemark-input:focus {
        border-color: #9bc8ff;
        box-shadow: 0 0 0 2px rgba(123, 188, 255, 0.26);
      }
      #musemark-overlay .musemark-hint {
        margin-top: 8px;
        font-size: 11px;
        color: #b8d1ff;
      }
      #musemark-overlay .musemark-actions {
        margin-top: 10px;
        display: flex;
        justify-content: flex-end;
      }
      #musemark-overlay .musemark-manager {
        border: none;
        border-radius: 10px;
        background: #86d4ff;
        color: #072039;
        font-weight: 650;
        padding: 7px 10px;
        cursor: pointer;
        font-size: 12px;
      }
      @keyframes musemark-enter {
        from {
          transform: translateY(8px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
    `;

    const status = root.querySelector(".musemark-status") as HTMLDivElement;
    const summary = root.querySelector(".musemark-summary") as HTMLDivElement;
    const noteInput = root.querySelector(".musemark-input") as HTMLInputElement;
    const categoryBox = root.querySelector(".musemark-category-box") as HTMLDivElement;
    const tagBox = root.querySelector(".musemark-tag-box") as HTMLDivElement;
    const saveHint = root.querySelector(".musemark-hint") as HTMLDivElement;
    const managerButton = root.querySelector(".musemark-manager") as HTMLButtonElement;
    let composing = false;

    noteInput.addEventListener("compositionstart", () => {
      composing = true;
    });
    noteInput.addEventListener("compositionend", () => {
      composing = false;
    });

    noteInput.addEventListener("keydown", (event) => {
      const isImeComposing = composing || event.isComposing || event.keyCode === 229;
      if (event.key === "Enter" && !event.shiftKey && !isImeComposing) {
        event.preventDefault();
        void submitCurrent();
      }
    });

    managerButton.addEventListener("click", () => {
      void sendRuntimeMessage("content/openManager", {});
    });

    root.style.display = "none";
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(root);

    overlayElements = {
      root,
      status,
      summary,
      noteInput,
      categoryBox,
      tagBox,
      saveHint
    };

    return overlayElements;
  }

  function showOverlay(statusText: string): void {
    const overlay = ensureOverlay();
    overlay.root.style.display = "block";
    overlay.status.textContent = statusText;
    overlay.summary.textContent = "";
    overlay.noteInput.value = "";
    overlay.saveHint.textContent = "Enter = save now, Esc = close (keeps bookmark in Inbox)";
    overlay.categoryBox.innerHTML = "";
    overlay.tagBox.innerHTML = "";
    overlay.noteInput.focus();
    setDockSuppressedByOverlay(true);
  }

  function hideOverlay(): void {
    if (!overlayElements) {
      return;
    }
    overlayElements.root.style.display = "none";
    setDockSuppressedByOverlay(false);
  }

  function updateForStage1(summary: string, categories: string[], tags: string[], truncated: boolean): void {
    const overlay = ensureOverlay();
    overlay.status.textContent = "AI analyzed page. Add a note and press Enter.";
    overlay.summary.textContent = truncated ? `${summary}\n\nText was truncated due to max character limit.` : summary;
    overlay.noteInput.focus();
    renderCategoryChips(categories);
    renderTagChips(tags);
  }

  function renderCategoryChips(categories: string[]): void {
    if (!overlayElements) {
      return;
    }
    overlayElements.categoryBox.innerHTML = "";
    for (const rawCategory of categories.slice(0, 6)) {
      const category = normalizeLabel(rawCategory);
      if (!category) {
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "musemark-chip";
      button.textContent = category;
      button.addEventListener("click", () => {
        selectedCategory = selectedCategory === category ? "" : category;
        const all = overlayElements?.categoryBox.querySelectorAll(".musemark-chip") ?? [];
        all.forEach((chip) => chip.classList.remove("active"));
        if (selectedCategory === category) {
          button.classList.add("active");
        }
      });
      overlayElements.categoryBox.appendChild(button);
    }
  }

  function renderTagChips(tags: string[]): void {
    if (!overlayElements) {
      return;
    }
    overlayElements.tagBox.innerHTML = "";
    for (const rawTag of tags.slice(0, 12)) {
      const tag = normalizeLabel(rawTag);
      if (!tag) {
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "musemark-chip";
      button.textContent = tag;
      button.addEventListener("click", () => {
        if (selectedTags.has(tag)) {
          selectedTags.delete(tag);
          button.classList.remove("active");
        } else {
          selectedTags.add(tag);
          button.classList.add("active");
        }
      });
      overlayElements.tagBox.appendChild(button);
    }
  }

  async function submitCurrent(): Promise<void> {
    if (!overlayElements || submitting || !currentSessionId) {
      return;
    }
    submitting = true;
    overlayElements.status.textContent = "Saving...";

    try {
      await sendRuntimeMessage("content/submitNote", {
        sessionId: currentSessionId,
        bookmarkId: currentBookmarkId || undefined,
        note: overlayElements.noteInput.value,
        selectedCategory: selectedCategory || undefined,
        selectedTags: Array.from(selectedTags)
      });
    } catch (error) {
      submitting = false;
      overlayElements.status.textContent = "Save failed";
      overlayElements.summary.textContent = toErrorMessage(error);
    }
  }

  async function initializeQuickDock(): Promise<void> {
    await refreshQuickDock();

    if (dockRefreshTimer !== undefined) {
      clearInterval(dockRefreshTimer);
    }
    dockRefreshTimer = window.setInterval(() => {
      void refreshQuickDock();
    }, 45_000);
  }

  async function refreshQuickDock(): Promise<void> {
    let payload: DockStatePayload;
    try {
      payload = await sendRuntimeMessage<DockStatePayload>("quickDock/getState", {
        currentUrl: location.href
      });
    } catch (error) {
      const message = toErrorMessage(error).toLowerCase();
      if (message.includes("unknown message type") || message.includes("quickdock")) {
        dockEnabled = false;
        if (dockElements) {
          dockElements.root.style.display = "none";
        }
      }
      return;
    }

    dockEnabled = Boolean(payload.enabled);
    dockEntries = Array.isArray(payload.entries) ? payload.entries : [];
    dockPinnedIds = new Set(Array.isArray(payload.pinnedIds) ? payload.pinnedIds : []);
    dockProfiles = Array.isArray(payload.profiles) ? payload.profiles : [];
    dockActiveProfileId = payload.layout?.activeProfileId || "default";
    dockPinnedWindow = Boolean(payload.layout?.pinned);
    dockMode = normalizeDockMode(payload.layout?.mode) || dockMode;

    if (!dockEnabled) {
      if (dockElements) {
        dockElements.root.style.display = "none";
      }
      return;
    }

    if (dockFocusedIndex >= dockEntries.length) {
      dockFocusedIndex = 0;
    }

    const dock = ensureDock();
    dock.root.style.display = dockSuppressedByOverlay ? "none" : "block";
    renderDock();
  }

  function ensureDock(): DockElements {
    if (dockElements) {
      return dockElements;
    }

    ensureDockStyle();

    const root = document.createElement("div");
    root.id = "musemark-quickdock";
    root.innerHTML = `
      <button class="anqd-toggle" type="button" title="Open QuickDock (Cmd/Ctrl+Shift+K)">Dock</button>
      <div class="anqd-peek"></div>
      <div class="anqd-panel">
        <div class="anqd-head">
          <div class="anqd-title-wrap">
            <strong>QuickDock</strong>
            <span class="anqd-profile">Default</span>
          </div>
          <div class="anqd-head-actions">
            <button class="anqd-btn anqd-save" type="button">Save</button>
            <button class="anqd-btn anqd-library" type="button">Library</button>
            <button class="anqd-btn anqd-pin" type="button">Pin</button>
            <button class="anqd-btn anqd-collapse" type="button">Collapse</button>
            <button class="anqd-btn anqd-more" type="button">More</button>
          </div>
        </div>
        <div class="anqd-list"></div>
      </div>
    `;

    const toggle = root.querySelector(".anqd-toggle") as HTMLButtonElement;
    const peek = root.querySelector(".anqd-peek") as HTMLDivElement;
    const panel = root.querySelector(".anqd-panel") as HTMLDivElement;
    const list = root.querySelector(".anqd-list") as HTMLDivElement;
    const saveButton = root.querySelector(".anqd-save") as HTMLButtonElement;
    const libraryButton = root.querySelector(".anqd-library") as HTMLButtonElement;
    const pinButton = root.querySelector(".anqd-pin") as HTMLButtonElement;
    const collapseButton = root.querySelector(".anqd-collapse") as HTMLButtonElement;
    const moreButton = root.querySelector(".anqd-more") as HTMLButtonElement;
    const profileLabel = root.querySelector(".anqd-profile") as HTMLSpanElement;

    toggle.addEventListener("click", () => {
      void setDockMode(dockMode === "collapsed" ? "expanded" : "collapsed", true);
    });

    toggle.addEventListener("mouseenter", () => {
      if (!dockPinnedWindow && dockMode === "collapsed") {
        void setDockMode("peek", false);
      }
    });

    root.addEventListener("mouseleave", () => {
      if (!dockPinnedWindow && dockMode === "peek") {
        void setDockMode("collapsed", false);
      }
    });

    saveButton.addEventListener("click", () => {
      void triggerSaveCurrentPage();
    });

    libraryButton.addEventListener("click", () => {
      void openLibraryFromDock();
    });

    pinButton.addEventListener("click", () => {
      void toggleDockPinMode();
    });

    collapseButton.addEventListener("click", () => {
      void setDockMode("collapsed", true);
    });

    moreButton.addEventListener("click", () => {
      void openLibraryFromDock();
    });

    document.documentElement.appendChild(root);

    dockElements = {
      root,
      toggle,
      peek,
      panel,
      list,
      pinButton,
      collapseButton,
      libraryButton,
      saveButton,
      moreButton,
      profileLabel
    };

    return dockElements;
  }

  function ensureDockStyle(): void {
    if (document.getElementById(QUICKDOCK_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = QUICKDOCK_STYLE_ID;
    style.textContent = `
      #musemark-quickdock {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483645;
        font-family: "Avenir Next", "SF Pro Text", "Noto Sans", sans-serif;
        color: #edf5ff;
      }
      #musemark-quickdock .anqd-toggle {
        border: 1px solid rgba(180, 202, 245, 0.35);
        background: linear-gradient(145deg, #123056 0%, #173d6f 60%, #235184 100%);
        color: #f4f9ff;
        border-radius: 999px;
        height: 40px;
        min-width: 68px;
        padding: 0 14px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.2px;
        box-shadow: 0 14px 28px rgba(4, 15, 34, 0.36);
      }
      #musemark-quickdock .anqd-peek {
        display: none;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        padding: 8px;
        border-radius: 12px;
        background: rgba(8, 23, 46, 0.9);
        border: 1px solid rgba(180, 202, 245, 0.26);
        box-shadow: 0 14px 30px rgba(4, 15, 34, 0.35);
      }
      #musemark-quickdock .anqd-peek-item {
        width: 24px;
        height: 24px;
        border: none;
        border-radius: 7px;
        background: rgba(40, 80, 132, 0.85);
        color: #e5efff;
        cursor: pointer;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        font-size: 10px;
      }
      #musemark-quickdock .anqd-peek-item img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      #musemark-quickdock .anqd-panel {
        display: none;
        margin-top: 8px;
        width: min(360px, calc(100vw - 24px));
        border-radius: 14px;
        border: 1px solid rgba(180, 202, 245, 0.28);
        background: linear-gradient(155deg, rgba(9, 27, 52, 0.97) 0%, rgba(10, 34, 66, 0.95) 54%, rgba(18, 53, 90, 0.95) 100%);
        box-shadow: 0 20px 44px rgba(3, 12, 27, 0.48);
        backdrop-filter: blur(6px);
      }
      #musemark-quickdock .anqd-head {
        padding: 10px 11px;
        border-bottom: 1px solid rgba(171, 197, 243, 0.18);
      }
      #musemark-quickdock .anqd-title-wrap {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      #musemark-quickdock .anqd-title-wrap strong {
        font-size: 13px;
        letter-spacing: 0.2px;
      }
      #musemark-quickdock .anqd-profile {
        font-size: 11px;
        color: #b7d0f8;
      }
      #musemark-quickdock .anqd-head-actions {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      #musemark-quickdock .anqd-btn {
        border: 1px solid rgba(163, 192, 244, 0.3);
        background: rgba(20, 49, 83, 0.82);
        color: #e4efff;
        border-radius: 8px;
        font-size: 11px;
        line-height: 1;
        padding: 7px 8px;
        cursor: pointer;
      }
      #musemark-quickdock .anqd-btn:hover {
        background: rgba(37, 77, 126, 0.92);
      }
      #musemark-quickdock .anqd-list {
        max-height: min(48vh, 360px);
        overflow: auto;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      #musemark-quickdock .anqd-item {
        border: 1px solid transparent;
        background: rgba(18, 44, 76, 0.8);
        border-radius: 10px;
        color: #ecf4ff;
        padding: 7px;
        display: grid;
        grid-template-columns: 22px 1fr auto;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        text-align: left;
      }
      #musemark-quickdock .anqd-item:hover {
        border-color: rgba(140, 178, 238, 0.55);
        background: rgba(30, 69, 112, 0.9);
      }
      #musemark-quickdock .anqd-item:active {
        transform: translateY(1px);
      }
      #musemark-quickdock .anqd-item.selected {
        border-color: rgba(141, 198, 255, 0.9);
        box-shadow: 0 0 0 1px rgba(141, 198, 255, 0.35) inset;
      }
      #musemark-quickdock .anqd-item.action {
        grid-template-columns: 1fr auto;
      }
      #musemark-quickdock .anqd-favicon {
        width: 22px;
        height: 22px;
        border-radius: 6px;
        overflow: hidden;
        background: rgba(28, 66, 105, 0.95);
      }
      #musemark-quickdock .anqd-favicon img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      #musemark-quickdock .anqd-fallback {
        width: 100%;
        height: 100%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: 700;
      }
      #musemark-quickdock .anqd-item-main {
        min-width: 0;
      }
      #musemark-quickdock .anqd-item-title {
        font-size: 12px;
        font-weight: 620;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #musemark-quickdock .anqd-item-sub {
        font-size: 10px;
        color: #b9cff0;
        margin-top: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #musemark-quickdock .anqd-badge {
        font-size: 10px;
        border-radius: 999px;
        border: 1px solid rgba(147, 189, 246, 0.45);
        background: rgba(27, 74, 125, 0.88);
        color: #e8f4ff;
        padding: 2px 7px;
      }
      #musemark-quickdock .anqd-empty {
        border-radius: 10px;
        border: 1px dashed rgba(170, 193, 237, 0.4);
        color: #c4d8f5;
        background: rgba(14, 36, 63, 0.72);
        padding: 9px;
        font-size: 11px;
      }
      #musemark-quickdock .anqd-menu {
        position: fixed;
        z-index: 2147483646;
        min-width: 190px;
        border-radius: 10px;
        border: 1px solid rgba(170, 193, 237, 0.35);
        background: rgba(10, 31, 57, 0.98);
        box-shadow: 0 14px 28px rgba(5, 12, 26, 0.45);
        padding: 6px;
        display: none;
      }
      #musemark-quickdock .anqd-menu button {
        width: 100%;
        text-align: left;
        border: none;
        border-radius: 7px;
        background: transparent;
        color: #e9f2ff;
        font-size: 12px;
        padding: 7px;
        cursor: pointer;
      }
      #musemark-quickdock .anqd-menu button:hover {
        background: rgba(33, 73, 118, 0.9);
      }
      #musemark-quickdock.mode-collapsed .anqd-panel,
      #musemark-quickdock.mode-collapsed .anqd-peek {
        display: none;
      }
      #musemark-quickdock.mode-peek .anqd-panel {
        display: none;
      }
      #musemark-quickdock.mode-peek .anqd-peek {
        display: flex;
      }
      #musemark-quickdock.mode-expanded .anqd-panel {
        display: block;
      }
      #musemark-quickdock.mode-expanded .anqd-peek {
        display: none;
      }
      #musemark-quickdock.window-pinned .anqd-toggle {
        border-color: rgba(153, 205, 255, 0.8);
      }
      @media (max-width: 720px) {
        #musemark-quickdock {
          right: 12px;
          bottom: 12px;
        }
        #musemark-quickdock .anqd-panel {
          width: min(340px, calc(100vw - 16px));
        }
      }
    `;

    document.documentElement.appendChild(style);
  }

  function renderDock(): void {
    if (!dockElements) {
      return;
    }

    const profileName = dockProfiles.find((entry) => entry.id === dockActiveProfileId)?.name || "Default";
    dockElements.profileLabel.textContent = profileName;
    dockElements.pinButton.textContent = dockPinnedWindow ? "Unpin" : "Pin";
    dockElements.root.classList.toggle("window-pinned", dockPinnedWindow);
    dockElements.root.classList.remove("mode-collapsed", "mode-peek", "mode-expanded");
    dockElements.root.classList.add(`mode-${dockMode}`);
    dockElements.toggle.textContent = dockMode === "expanded" ? "Hide" : "Dock";

    renderDockPeek();
    renderDockEntries();
  }

  function renderDockPeek(): void {
    if (!dockElements) {
      return;
    }

    dockElements.peek.innerHTML = "";
    for (const entry of dockEntries.slice(0, 3)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "anqd-peek-item";
      button.title = entry.title;

      if (entry.kind === "bookmark") {
        if (entry.favIconUrl) {
          const img = document.createElement("img");
          img.src = entry.favIconUrl;
          img.alt = entry.domain || entry.title;
          button.appendChild(img);
        } else {
          button.textContent = (entry.domain || entry.title || "?").slice(0, 1).toUpperCase();
        }
      } else {
        button.textContent = entry.action === "open_library" ? "L" : "S";
      }

      button.addEventListener("click", () => {
        void openDockEntry(entry);
      });
      dockElements.peek.appendChild(button);
    }
  }

  function renderDockEntries(): void {
    if (!dockElements) {
      return;
    }

    dockElements.list.innerHTML = "";

    if (dockEntries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "anqd-empty";
      empty.textContent = "No bookmark available. Try Save Current Page or open Library.";
      dockElements.list.appendChild(empty);
      return;
    }

    dockEntries.forEach((entry, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `anqd-item ${entry.kind === "action" ? "action" : "bookmark"}`;
      if (index === dockFocusedIndex && dockMode === "expanded") {
        row.classList.add("selected");
      }

      if (entry.kind === "bookmark") {
        const icon = document.createElement("div");
        icon.className = "anqd-favicon";
        if (entry.favIconUrl) {
          const img = document.createElement("img");
          img.src = entry.favIconUrl;
          img.alt = entry.domain || entry.title;
          icon.appendChild(img);
        } else {
          const fallback = document.createElement("div");
          fallback.className = "anqd-fallback";
          fallback.textContent = (entry.domain || entry.title || "?").slice(0, 1).toUpperCase();
          icon.appendChild(fallback);
        }

        const main = document.createElement("div");
        main.className = "anqd-item-main";

        const title = document.createElement("div");
        title.className = "anqd-item-title";
        title.textContent = entry.title;
        main.appendChild(title);

        const subtitle = document.createElement("div");
        subtitle.className = "anqd-item-sub";
        subtitle.textContent = entry.subtitle || entry.domain || entry.url || "";
        main.appendChild(subtitle);

        const badge = document.createElement("span");
        badge.className = "anqd-badge";
        badge.textContent = entry.pinned || dockPinnedIds.has(entry.id) ? "Pinned" : "Open";

        row.appendChild(icon);
        row.appendChild(main);
        row.appendChild(badge);

        row.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          showDockContextMenu(entry, event.clientX, event.clientY);
        });
      } else {
        const main = document.createElement("div");
        main.className = "anqd-item-main";
        const title = document.createElement("div");
        title.className = "anqd-item-title";
        title.textContent = entry.title;
        main.appendChild(title);

        if (entry.subtitle) {
          const subtitle = document.createElement("div");
          subtitle.className = "anqd-item-sub";
          subtitle.textContent = entry.subtitle;
          main.appendChild(subtitle);
        }

        const badge = document.createElement("span");
        badge.className = "anqd-badge";
        badge.textContent = "Action";

        row.appendChild(main);
        row.appendChild(badge);
      }

      row.addEventListener("click", () => {
        dockFocusedIndex = index;
        void openDockEntry(entry);
      });

      dockElements?.list.appendChild(row);
    });
  }

  async function setDockMode(mode: DockMode, persist: boolean): Promise<void> {
    dockMode = mode;
    renderDock();
    if (persist) {
      try {
        await sendRuntimeMessage<{ layout?: DockLayoutState }>("quickDock/updateLayout", {
          mode
        });
      } catch {
        return;
      }
    }
  }

  async function toggleDockByShortcut(): Promise<void> {
    if (!dockEnabled) {
      return;
    }
    if (dockMode === "expanded") {
      await setDockMode("collapsed", true);
      return;
    }
    await setDockMode("expanded", true);
    dockFocusedIndex = 0;
    renderDockEntries();
  }

  async function toggleDockPinMode(): Promise<void> {
    dockPinnedWindow = !dockPinnedWindow;
    renderDock();
    try {
      await sendRuntimeMessage<{ layout?: DockLayoutState }>("quickDock/updateLayout", {
        pinned: dockPinnedWindow
      });
    } catch {
      return;
    }
  }

  async function openDockEntry(entry: DockEntry): Promise<void> {
    try {
      await sendRuntimeMessage("quickDock/open", {
        id: entry.kind === "bookmark" ? entry.id : undefined,
        url: entry.url,
        action: entry.kind === "action" ? entry.action : undefined,
        source: "dock"
      });
      hideDockContextMenu();
      window.setTimeout(() => {
        void refreshQuickDock();
      }, 120);
    } catch {
      return;
    }
  }

  async function openLibraryFromDock(): Promise<void> {
    try {
      await sendRuntimeMessage("quickDock/open", {
        action: "open_library",
        source: "dock"
      });
    } catch {
      return;
    }
  }

  async function triggerSaveCurrentPage(): Promise<void> {
    try {
      await sendRuntimeMessage("quickDock/saveCurrent", {});
      window.setTimeout(() => {
        void refreshQuickDock();
      }, 250);
    } catch {
      return;
    }
  }

  function showDockContextMenu(entry: DockEntry, x: number, y: number): void {
    if (entry.kind !== "bookmark") {
      return;
    }
    const menu = ensureDockContextMenu();
    const isPinned = dockPinnedIds.has(entry.id) || Boolean(entry.pinned);
    menu.innerHTML = "";

    const pinButton = document.createElement("button");
    pinButton.type = "button";
    pinButton.textContent = isPinned ? "Unpin from Dock" : "Pin to Dock";
    pinButton.addEventListener("click", () => {
      void (async () => {
        try {
          await sendRuntimeMessage(isPinned ? "quickDock/unpin" : "quickDock/pin", {
            bookmarkId: entry.id
          });
          hideDockContextMenu();
          await refreshQuickDock();
        } catch {
          return;
        }
      })();
    });

    const dismissButton = document.createElement("button");
    dismissButton.type = "button";
    dismissButton.textContent = "Remove from suggestions";
    dismissButton.addEventListener("click", () => {
      void (async () => {
        try {
          await sendRuntimeMessage("quickDock/dismiss", {
            bookmarkId: entry.id,
            days: 30
          });
          hideDockContextMenu();
          await refreshQuickDock();
        } catch {
          return;
        }
      })();
    });

    const openLibraryButton = document.createElement("button");
    openLibraryButton.type = "button";
    openLibraryButton.textContent = "Open in Library";
    openLibraryButton.addEventListener("click", () => {
      void openLibraryFromDock();
      hideDockContextMenu();
    });

    menu.appendChild(pinButton);
    menu.appendChild(dismissButton);
    menu.appendChild(openLibraryButton);

    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 210))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 140))}px`;
    menu.style.display = "block";
  }

  function ensureDockContextMenu(): HTMLDivElement {
    if (dockContextMenu) {
      return dockContextMenu;
    }
    const root = ensureDock();
    const menu = document.createElement("div");
    menu.className = "anqd-menu";
    root.root.appendChild(menu);
    dockContextMenu = menu;
    return menu;
  }

  function hideDockContextMenu(): void {
    if (!dockContextMenu) {
      return;
    }
    dockContextMenu.style.display = "none";
  }

  function setDockSuppressedByOverlay(suppressed: boolean): void {
    dockSuppressedByOverlay = suppressed;
    if (!dockElements) {
      return;
    }
    dockElements.root.style.display = suppressed ? "none" : dockEnabled ? "block" : "none";
  }

  async function sendRuntimeMessage<TResponse = unknown>(type: string, payload?: unknown): Promise<TResponse> {
    const response = (await chrome.runtime.sendMessage({
      protocolVersion: PROTOCOL_VERSION,
      type,
      payload
    })) as {
      ok?: boolean;
      data?: TResponse;
      error?: string;
    };

    if (!response?.ok) {
      throw new Error(response?.error || `Runtime message failed: ${type}`);
    }

    return response.data as TResponse;
  }

  function normalizeDockMode(mode: unknown): DockMode | undefined {
    if (mode === "collapsed" || mode === "peek" || mode === "expanded") {
      return mode;
    }
    return undefined;
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const tag = target.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") {
      return true;
    }
    return Boolean(target.closest("[contenteditable='true']"));
  }

  async function collectCapturePayload(sessionId: string, maxChars: number): Promise<{
    sessionId: string;
    url: string;
    canonicalUrl?: string;
    title: string;
    domain: string;
    favIconUrl?: string;
    selection: string;
    text: string;
    textDigest: string;
    textChars: number;
    captureMode: "readability" | "dom_text" | "selection_only";
    wasTruncated: boolean;
  }> {
    const title = document.title || location.hostname;
    const canonicalLink = document.querySelector("link[rel='canonical']") as HTMLLinkElement | null;
    const canonicalUrl = canonicalLink?.href || undefined;
    const favIconUrl = resolveBestFaviconUrl();

    const selection = window.getSelection()?.toString().trim() ?? "";
    const articleNode = document.querySelector("article, main");
    const articleText = articleNode?.textContent?.trim() ?? "";
    const bodyText = document.body?.innerText?.trim() ?? "";
    const primaryText = articleText || bodyText;
    const captureMode = selection && !primaryText ? "selection_only" : articleText ? "readability" : "dom_text";

    const rawText = selection ? `${selection}\n\n${primaryText}` : primaryText;
    const normalized = normalizeText(rawText);
    const wasTruncated = normalized.length > maxChars;
    const text = normalized.slice(0, maxChars);
    const digest = await sha256Hex(text || `${location.href}|${title}`);

    return {
      sessionId,
      url: location.href,
      canonicalUrl,
      title,
      domain: location.hostname,
      favIconUrl,
      selection,
      text,
      textDigest: digest,
      textChars: normalized.length,
      captureMode,
      wasTruncated
    };
  }

  function resolveBestFaviconUrl(): string | undefined {
    const links = Array.from(document.querySelectorAll("link[rel*='icon'], link[rel='apple-touch-icon']")) as HTMLLinkElement[];

    let bestUrl = "";
    let bestScore = -1;

    for (const link of links) {
      const href = toAbsoluteUrl(link.getAttribute("href"));
      if (!href || href.startsWith("data:")) {
        continue;
      }

      const rel = (link.rel || "").toLowerCase();
      const type = (link.type || "").toLowerCase();
      const sizeScore = parseIconSizeScore(link.sizes?.value);

      let score = sizeScore;
      if (rel.includes("icon")) {
        score += 40;
      }
      if (rel.includes("shortcut")) {
        score += 12;
      }
      if (rel.includes("apple-touch-icon")) {
        score += 20;
      }
      if (type.includes("svg")) {
        score += 18;
      }
      if (href.includes("favicon")) {
        score += 8;
      }

      if (score > bestScore) {
        bestScore = score;
        bestUrl = href;
      }
    }

    if (bestUrl) {
      return bestUrl;
    }

    try {
      return new URL("/favicon.ico", location.origin).toString();
    } catch {
      return undefined;
    }
  }

  function parseIconSizeScore(sizesValue?: string): number {
    const value = (sizesValue ?? "").trim().toLowerCase();
    if (!value || value === "any") {
      return 24;
    }

    let best = 0;
    for (const token of value.split(/\s+/)) {
      const matched = token.match(/^(\d+)x(\d+)$/);
      if (!matched) {
        continue;
      }
      const width = Number(matched[1]);
      const height = Number(matched[2]);
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        continue;
      }
      best = Math.max(best, Math.min(width, height));
    }

    if (best <= 0) {
      return 8;
    }
    return Math.min(96, best);
  }

  function toAbsoluteUrl(href: string | null): string {
    const value = (href ?? "").trim();
    if (!value) {
      return "";
    }
    try {
      return new URL(value, location.href).toString();
    } catch {
      return "";
    }
  }

  async function sha256Hex(input: string): Promise<string> {
    try {
      const data = new TextEncoder().encode(input);
      const digest = await crypto.subtle.digest("SHA-256", data);
      const bytes = Array.from(new Uint8Array(digest));
      return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch {
      return fallbackHash(input);
    }
  }

  function fallbackHash(input: string): string {
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
      hash = (hash << 5) - hash + input.charCodeAt(index);
      hash |= 0;
    }
    return `fallback_${Math.abs(hash)}`;
  }

  function normalizeText(text: string): string {
    return text.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  function normalizeLabel(label: string): string {
    return label.trim().replace(/\s+/g, " ").slice(0, 40);
  }

  function toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error ?? "Unknown error");
  }
})();
