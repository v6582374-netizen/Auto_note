(() => {
  const PROTOCOL_VERSION = 1;
  const GLOBAL_KEY = "__autonote_content_ready__";

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

  let overlayElements: OverlayElements | null = null;
  let currentSessionId = "";
  let currentBookmarkId = "";
  let selectedCategory = "";
  let selectedTags = new Set<string>();
  let submitting = false;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.protocolVersion !== PROTOCOL_VERSION) {
      return false;
    }

    if (message.type === "autonote/startCapture") {
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

    if (message.type === "autonote/bookmarkLinked") {
      const payload = message.payload as { sessionId: string; bookmarkId: string };
      if (payload.sessionId === currentSessionId) {
        currentBookmarkId = payload.bookmarkId;
      }
      return false;
    }

    if (message.type === "autonote/stage1Ready") {
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

    if (message.type === "autonote/classifyPending") {
      const payload = message.payload as { sessionId: string };
      if (payload.sessionId === currentSessionId && overlayElements) {
        overlayElements.status.textContent = "Classifying and saving...";
      }
      return false;
    }

    if (message.type === "autonote/stageError") {
      const payload = message.payload as { sessionId: string; error: string };
      if (payload.sessionId === currentSessionId && overlayElements) {
        submitting = false;
        overlayElements.status.textContent = "Saved to Inbox with AI error";
        overlayElements.summary.textContent = payload.error;
      }
      return false;
    }

    if (message.type === "autonote/finalized") {
      const payload = message.payload as { sessionId: string; category?: string; tags?: string[] };
      if (payload.sessionId === currentSessionId && overlayElements) {
        submitting = false;
        const category = payload.category || "Uncategorized";
        const tags = (payload.tags ?? []).join(", ");
        overlayElements.status.textContent = `Saved: ${category}${tags ? ` | ${tags}` : ""}`;
        overlayElements.summary.textContent = "Done. Auto closing...";
        window.setTimeout(() => hideOverlay(), 1200);
      }
      return false;
    }

    return false;
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlayElements?.root.style.display !== "none") {
      hideOverlay();
    }
  });

  function ensureOverlay(): OverlayElements {
    if (overlayElements) {
      return overlayElements;
    }

    const root = document.createElement("div");
    root.id = "autonote-overlay";
    root.innerHTML = `
      <div class="autonote-card">
        <div class="autonote-title">AutoNote</div>
        <div class="autonote-status"></div>
        <div class="autonote-summary"></div>
        <div class="autonote-section">
          <div class="autonote-label">Category candidates</div>
          <div class="autonote-category-box"></div>
        </div>
        <div class="autonote-section">
          <div class="autonote-label">Tag candidates</div>
          <div class="autonote-tag-box"></div>
        </div>
        <input class="autonote-input" type="text" maxlength="200" placeholder="One-line note (optional). Press Enter to save..." />
        <div class="autonote-hint">Enter = save now, Esc = close (keeps bookmark in Inbox)</div>
        <div class="autonote-actions">
          <button class="autonote-manager">Open Library</button>
        </div>
      </div>
    `;

    const style = document.createElement("style");
    style.textContent = `
      #autonote-overlay {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        width: min(430px, calc(100vw - 28px));
        font-family: "Avenir Next", "SF Pro Display", "Noto Sans SC", sans-serif;
      }
      #autonote-overlay .autonote-card {
        border-radius: 16px;
        background: linear-gradient(135deg, #101a34 0%, #1d2746 48%, #1f385f 100%);
        color: #f4f8ff;
        border: 1px solid rgba(214, 224, 255, 0.28);
        box-shadow: 0 22px 52px rgba(5, 10, 25, 0.42);
        padding: 14px 14px 12px;
        backdrop-filter: blur(8px);
        animation: autonote-enter 170ms ease-out;
      }
      #autonote-overlay .autonote-title {
        font-weight: 750;
        letter-spacing: 0.2px;
        font-size: 15px;
        margin-bottom: 8px;
      }
      #autonote-overlay .autonote-status {
        font-size: 13px;
        color: #d3e2ff;
      }
      #autonote-overlay .autonote-summary {
        margin-top: 8px;
        font-size: 12px;
        line-height: 1.45;
        color: #d8e6ff;
        max-height: 88px;
        overflow: auto;
        white-space: pre-wrap;
      }
      #autonote-overlay .autonote-section {
        margin-top: 10px;
      }
      #autonote-overlay .autonote-label {
        font-size: 11px;
        color: #a8c5ff;
        margin-bottom: 6px;
      }
      #autonote-overlay .autonote-category-box,
      #autonote-overlay .autonote-tag-box {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      #autonote-overlay .autonote-chip {
        border: 1px solid rgba(190, 212, 255, 0.4);
        background: rgba(23, 46, 79, 0.72);
        color: #eff6ff;
        border-radius: 999px;
        font-size: 11px;
        padding: 4px 9px;
        cursor: pointer;
      }
      #autonote-overlay .autonote-chip.active {
        background: #8bd1ff;
        border-color: #8bd1ff;
        color: #07203a;
      }
      #autonote-overlay .autonote-input {
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
      #autonote-overlay .autonote-input:focus {
        border-color: #9bc8ff;
        box-shadow: 0 0 0 2px rgba(123, 188, 255, 0.26);
      }
      #autonote-overlay .autonote-hint {
        margin-top: 8px;
        font-size: 11px;
        color: #b8d1ff;
      }
      #autonote-overlay .autonote-actions {
        margin-top: 10px;
        display: flex;
        justify-content: flex-end;
      }
      #autonote-overlay .autonote-manager {
        border: none;
        border-radius: 10px;
        background: #86d4ff;
        color: #072039;
        font-weight: 650;
        padding: 7px 10px;
        cursor: pointer;
        font-size: 12px;
      }
      @keyframes autonote-enter {
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

    const status = root.querySelector(".autonote-status") as HTMLDivElement;
    const summary = root.querySelector(".autonote-summary") as HTMLDivElement;
    const noteInput = root.querySelector(".autonote-input") as HTMLInputElement;
    const categoryBox = root.querySelector(".autonote-category-box") as HTMLDivElement;
    const tagBox = root.querySelector(".autonote-tag-box") as HTMLDivElement;
    const saveHint = root.querySelector(".autonote-hint") as HTMLDivElement;
    const managerButton = root.querySelector(".autonote-manager") as HTMLButtonElement;

    noteInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void submitCurrent();
      }
    });

    managerButton.addEventListener("click", () => {
      void chrome.runtime.sendMessage({
        protocolVersion: PROTOCOL_VERSION,
        type: "content/openManager",
        payload: {}
      });
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
  }

  function hideOverlay(): void {
    if (!overlayElements) {
      return;
    }
    overlayElements.root.style.display = "none";
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
      button.className = "autonote-chip";
      button.textContent = category;
      button.addEventListener("click", () => {
        selectedCategory = selectedCategory === category ? "" : category;
        const all = overlayElements?.categoryBox.querySelectorAll(".autonote-chip") ?? [];
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
      button.className = "autonote-chip";
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
      await chrome.runtime.sendMessage({
        protocolVersion: PROTOCOL_VERSION,
        type: "content/submitNote",
        payload: {
          sessionId: currentSessionId,
          bookmarkId: currentBookmarkId || undefined,
          note: overlayElements.noteInput.value,
          selectedCategory: selectedCategory || undefined,
          selectedTags: Array.from(selectedTags)
        }
      });
    } catch (error) {
      submitting = false;
      overlayElements.status.textContent = "Save failed";
      overlayElements.summary.textContent = toErrorMessage(error);
    }
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
