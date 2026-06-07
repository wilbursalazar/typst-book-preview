import {
  App,
  Editor,
  ItemView,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  SettingDefinitionItem,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
  normalizePath
} from "obsidian";
import { execFile, ExecFileOptionsWithStringEncoding, ExecFileException } from "child_process";
import * as path from "path";

const VIEW_TYPE_TYPST_BOOK_PREVIEW = "typst-book-preview";

type CompileStatus = "idle" | "compiling" | "success" | "error";
type TypstToolbarGroup = "basic" | "text" | "notes" | "headings" | "lists" | "layout" | "objects" | "templates";
type TypstToolbarGroups = Record<TypstToolbarGroup, boolean>;

interface TypstBookPreviewSettings {
  typstCommand: string;
  mainTypstPath: string;
  showTypstToolbar: boolean;
  toolbarGroups: TypstToolbarGroups;
}

interface CompileState {
  status: CompileStatus;
  message: string;
  errorText: string;
  pdfPath: string | null;
  updatedAt: number | null;
}

interface CompilePaths {
  vaultBasePath: string;
  inputVaultPath: string;
  outputVaultPath: string;
  inputAbsolutePath: string;
  outputAbsolutePath: string;
  workingDirectory: string;
}

const DEFAULT_TOOLBAR_GROUPS: TypstToolbarGroups = {
  basic: true,
  text: true,
  notes: true,
  headings: true,
  lists: true,
  layout: true,
  objects: true,
  templates: true
};

const DEFAULT_SETTINGS: TypstBookPreviewSettings = {
  typstCommand: "typst",
  mainTypstPath: "book.typ",
  showTypstToolbar: true,
  toolbarGroups: { ...DEFAULT_TOOLBAR_GROUPS }
};

const TYPST_TOOLBAR_GROUP_OPTIONS: Array<{
  id: TypstToolbarGroup;
  name: string;
  description: string;
}> = [
  { id: "basic", name: "Basic text", description: "Emphasis, strong, raw text, math, highlight, underline, strike, subscript, superscript, and links." },
  { id: "text", name: "Text refinements", description: "Small capitals, overline, uppercase, and lowercase." },
  { id: "notes", name: "Notes and references", description: "Footnotes, quotes, labels, references, and citations." },
  { id: "headings", name: "Headings", description: "Heading levels H1 through H6." },
  { id: "lists", name: "Lists and comments", description: "Bullet, numbered, term-list, and line-comment prefixes." },
  { id: "layout", name: "Layout", description: "Outline, page break, and columns." },
  { id: "objects", name: "Objects", description: "Figure, table, and bibliography snippets." },
  { id: "templates", name: "Templates", description: "Paperback book and article/report starters." }
];

const DEFAULT_STATE: CompileState = {
  status: "idle",
  message: "Ready",
  errorText: "",
  pdfPath: null,
  updatedAt: null
};

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "svg", "gif"]);

const PAPERBACK_TEMPLATE = `#set page(
  width: 5.5in,
  height: 8.5in,
  margin: (
    inside: 0.8in,
    outside: 0.55in,
    top: 0.65in,
    bottom: 0.75in,
  ),
  binding: left,
  numbering: "1",
)
#set text(size: 10.5pt)
#set par(justify: true, first-line-indent: 1.2em)
#set heading(numbering: "1.")

#align(center)[
  #text(18pt)[Title]
  #v(0.5em)
  Author
]

#pagebreak()
#outline(title: [Contents])
#pagebreak()

= Chapter One

First paragraph.
`;

const ARTICLE_TEMPLATE = `#set page("us-letter", margin: 1in, numbering: "1")
#set text(size: 11pt)
#set par(justify: true)

#align(center)[
  #text(16pt, weight: "bold")[Title] \\
  Author
]

#v(1em)

= Introduction

First paragraph.

// #bibliography("works.bib")
`;

interface TypstToolbarTool {
  label: string;
  title: string;
  kind?: "wrap" | "insert" | "line-prefix";
  group: TypstToolbarGroup;
  prefix?: string;
  suffix?: string;
  text?: string;
  linePrefix?: string;
  cursorOffset?: number;
  separatorBefore?: boolean;
}

const TYPST_TOOLBAR_TOOLS: TypstToolbarTool[] = [
  { label: "_", title: "Emphasis", group: "basic", prefix: "_", suffix: "_" },
  { label: "*", title: "Strong", group: "basic", prefix: "*", suffix: "*" },
  { label: "`", title: "Raw text", group: "basic", prefix: "`", suffix: "`" },
  { label: "$", title: "Math", group: "basic", prefix: "$", suffix: "$" },
  { label: "H", title: "Highlight", group: "basic", prefix: "#highlight[", suffix: "]" },
  { label: "U", title: "Underline", group: "basic", prefix: "#underline[", suffix: "]" },
  { label: "S", title: "Strike", group: "basic", prefix: "#strike[", suffix: "]" },
  { label: "sub", title: "Subscript", group: "basic", prefix: "#sub[", suffix: "]" },
  { label: "sup", title: "Superscript", group: "basic", prefix: "#super[", suffix: "]" },
  { label: "link", title: "Link", group: "basic", prefix: "#link(\"\")[", suffix: "]", cursorOffset: 7 },
  { label: "sc", title: "Small capitals", group: "text", prefix: "#smallcaps[", suffix: "]", separatorBefore: true },
  { label: "ovr", title: "Overline", group: "text", prefix: "#overline[", suffix: "]" },
  { label: "up", title: "Uppercase", group: "text", prefix: "#upper[", suffix: "]" },
  { label: "lo", title: "Lowercase", group: "text", prefix: "#lower[", suffix: "]" },
  { label: "Fn", title: "Footnote", group: "notes", prefix: "#footnote[", suffix: "]", separatorBefore: true },
  { label: "Q", title: "Block quote", group: "notes", prefix: "#quote(block: true)[\n", suffix: "\n]" },
  { label: "<>", title: "Label", group: "notes", prefix: "<", suffix: ">" },
  { label: "@", title: "Reference", group: "notes", prefix: "@", suffix: "" },
  { label: "cite", title: "Citation", group: "notes", prefix: "#cite(<", suffix: ">)" },
  { label: "H1", title: "Heading 1", group: "headings", kind: "line-prefix", linePrefix: "= ", separatorBefore: true },
  { label: "H2", title: "Heading 2", group: "headings", kind: "line-prefix", linePrefix: "== " },
  { label: "H3", title: "Heading 3", group: "headings", kind: "line-prefix", linePrefix: "=== " },
  { label: "H4", title: "Heading 4", group: "headings", kind: "line-prefix", linePrefix: "==== " },
  { label: "H5", title: "Heading 5", group: "headings", kind: "line-prefix", linePrefix: "===== " },
  { label: "H6", title: "Heading 6", group: "headings", kind: "line-prefix", linePrefix: "====== " },
  { label: "-", title: "Bullet list item", group: "lists", kind: "line-prefix", linePrefix: "- " },
  { label: "+", title: "Numbered list item", group: "lists", kind: "line-prefix", linePrefix: "+ " },
  { label: "/", title: "Term list item", group: "lists", kind: "line-prefix", linePrefix: "/ " },
  { label: "//", title: "Line comment", group: "lists", kind: "line-prefix", linePrefix: "// " },
  { label: "TOC", title: "Outline", group: "layout", kind: "insert", text: "#outline()\n", separatorBefore: true },
  { label: "Pg", title: "Page break", group: "layout", kind: "insert", text: "#pagebreak()\n" },
  { label: "Col", title: "Columns", group: "layout", prefix: "#columns(2, gutter: 1em)[\n", suffix: "\n]" },
  { label: "Fig", title: "Figure", group: "objects", prefix: "#figure(\n  [", suffix: "],\n  caption: [Caption],\n) <fig:label>" },
  {
    label: "Tbl",
    title: "Table",
    group: "objects",
    kind: "insert",
    text: "#table(\n  columns: 2,\n  table.header([Header 1], [Header 2]),\n  [Cell 1], [Cell 2],\n)\n",
    cursorOffset: "#table(\n  columns: ".length
  },
  {
    label: "Bib",
    title: "Bibliography",
    group: "objects",
    kind: "insert",
    text: "#bibliography(\"works.bib\")\n",
    cursorOffset: "#bibliography(\"".length
  },
  {
    label: "Book",
    title: "Paperback book template",
    group: "templates",
    kind: "insert",
    text: PAPERBACK_TEMPLATE,
    cursorOffset: PAPERBACK_TEMPLATE.indexOf("Title")
  },
  {
    label: "Art",
    title: "Article/report template",
    group: "templates",
    kind: "insert",
    text: ARTICLE_TEMPLATE,
    cursorOffset: ARTICLE_TEMPLATE.indexOf("Title")
  }
];

export default class TypstBookPreviewPlugin extends Plugin {
  settings: TypstBookPreviewSettings = {
    ...DEFAULT_SETTINGS,
    toolbarGroups: { ...DEFAULT_TOOLBAR_GROUPS }
  };
  state: CompileState = { ...DEFAULT_STATE };
  private compileTimer: number | null = null;
  private compileRunning = false;
  private compileQueued = false;
  private toolbarManager: TypstToolbarManager | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.toolbarManager = new TypstToolbarManager(this);
    this.toolbarManager.start();

    this.registerView(
      VIEW_TYPE_TYPST_BOOK_PREVIEW,
      (leaf) => new TypstBookPreviewView(leaf, this)
    );

    this.addRibbonIcon("book-open", "Open Typst Book Preview", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-preview",
      name: "Open preview",
      callback: () => {
        void this.activateView();
      }
    });

    this.addCommand({
      id: "compile",
      name: "Compile",
      callback: () => {
        void this.compile("manual");
      }
    });

    this.addCommand({
      id: "use-active-file-as-main-file",
      name: "Use active file as main file",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || !isTypstSourcePath(activeFile.path)) {
          return false;
        }

        if (!checking) {
          void this.setMainTypstPath(activeFile.path);
          new Notice(`Typst Book Preview: main file set to ${activeFile.path}`);
        }
        return true;
      }
    });

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.shouldCompileOnModify(file)) {
          this.scheduleCompile("save");
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile) || !this.getMainInputCandidates().includes(oldPath)) {
          return;
        }

        void this.setMainTypstPath(file.path);
        new Notice(`Typst Book Preview: main file moved to ${file.path}`);
      })
    );

    this.addSettingTab(new TypstBookPreviewSettingTab(this.app, this));
  }

  onunload(): void {
    if (this.compileTimer !== null) {
      window.clearTimeout(this.compileTimer);
      this.compileTimer = null;
    }
    this.toolbarManager?.removeToolbar();
  }

  async activateView(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TYPST_BOOK_PREVIEW)[0];
    if (existingLeaf) {
      this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: VIEW_TYPE_TYPST_BOOK_PREVIEW,
      active: true
    });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  scheduleCompile(reason: string, delayMs = 250): void {
    if (this.compileTimer !== null) {
      window.clearTimeout(this.compileTimer);
    }

    this.compileTimer = window.setTimeout(() => {
      this.compileTimer = null;
      void this.compile(reason);
    }, delayMs);
  }

  async compile(reason: string): Promise<void> {
    if (this.compileRunning) {
      this.compileQueued = true;
      return;
    }

    this.compileRunning = true;
    this.compileQueued = false;

    let compilePaths: CompilePaths;
    try {
      compilePaths = this.resolveCompilePaths();
    } catch (error) {
      const errorText = errorToString(error);
      this.setState({
        status: "error",
        message: "Typst compile could not start.",
        errorText,
        updatedAt: Date.now()
      });
      if (reason === "manual") {
        await this.activateView();
      }
      new Notice("Typst Book Preview: compile could not start.");
      this.finishCompile();
      return;
    }

    this.setState({
      status: "compiling",
      message: `Compiling ${compilePaths.inputVaultPath}...`,
      errorText: "",
      updatedAt: Date.now()
    });

    try {
      const command = this.getTypstCommand();
      const result = await execFilePromise(
        command,
        [
          "compile",
          "--root",
          compilePaths.vaultBasePath,
          compilePaths.inputAbsolutePath,
          compilePaths.outputAbsolutePath
        ],
        {
          cwd: compilePaths.workingDirectory,
          encoding: "utf8",
          env: { ...process.env, NO_COLOR: "1" },
          maxBuffer: 10 * 1024 * 1024,
          timeout: 60_000
        }
      );
      const compilerOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

      this.setState({
        status: "success",
        message: this.successMessage(reason, compilePaths.outputVaultPath),
        errorText: compilerOutput,
        pdfPath: compilePaths.outputVaultPath,
        updatedAt: Date.now()
      });
    } catch (error) {
      this.setState({
        status: "error",
        message: "Typst compile failed.",
        errorText: compilerErrorToString(error),
        updatedAt: Date.now()
      });
      if (reason === "manual") {
        await this.activateView();
      }
      new Notice("Typst Book Preview: Typst compile failed.");
    } finally {
      this.finishCompile();
    }
  }

  shouldCompileOnModify(file: TAbstractFile): boolean {
    if (!(file instanceof TFile)) {
      return false;
    }

    if (isTypstSourcePath(file.path)) {
      if (this.getMainInputCandidates().includes(file.path)) {
        return true;
      }

      return this.isInBookRoot(file.path);
    }

    if (isImageAssetPath(file.path)) {
      return this.isInBookRoot(file.path);
    }

    return false;
  }

  getMainTypstPath(): string {
    return normalizePath(this.settings.mainTypstPath.trim() || DEFAULT_SETTINGS.mainTypstPath);
  }

  getOutputPdfPath(): string {
    return getOutputPdfPath(this.getMainTypstPath());
  }

  getDisplayTypstCommand(): string {
    return this.settings.typstCommand.trim() || DEFAULT_SETTINGS.typstCommand;
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<TypstBookPreviewSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(loaded ?? {}),
      toolbarGroups: {
        ...DEFAULT_TOOLBAR_GROUPS,
        ...(loaded?.toolbarGroups ?? {})
      }
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async setMainTypstPath(vaultPath: string): Promise<void> {
    this.settings.mainTypstPath = normalizePath(vaultPath);
    await this.saveSettings();
    await this.refreshViews();
  }

  async refreshViews(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TYPST_BOOK_PREVIEW)) {
      if (leaf.view instanceof TypstBookPreviewView) {
        leaf.view.render();
      }
    }
  }

  refreshTypstToolbar(): void {
    this.toolbarManager?.refresh();
  }

  isTypstToolbarGroupEnabled(group: TypstToolbarGroup): boolean {
    return this.settings.toolbarGroups[group] ?? DEFAULT_TOOLBAR_GROUPS[group];
  }

  private finishCompile(): void {
    this.compileRunning = false;
    if (this.compileQueued) {
      this.scheduleCompile("queued", 100);
    }
  }

  private setState(nextState: Partial<CompileState>): void {
    this.state = {
      ...this.state,
      ...nextState
    };
    void this.refreshViews();
  }

  private successMessage(reason: string, outputPath: string): string {
    if (reason === "save" || reason === "queued") {
      return `Compiled on save: ${outputPath}`;
    }
    return `Compiled: ${outputPath}`;
  }

  private resolveCompilePaths(): CompilePaths {
    const inputVaultPath = this.getMainTypstPath();
    validateVaultPath(inputVaultPath, "Main Typst file");

    if (!isTypstSourcePath(inputVaultPath)) {
      throw new Error("Main Typst file must end with .typ or .typ.md.");
    }

    const inputFile = this.getMainInputCandidates()
      .map((candidatePath) => this.app.vault.getAbstractFileByPath(candidatePath))
      .find((file): file is TFile => file instanceof TFile);

    if (!(inputFile instanceof TFile)) {
      throw new Error(this.notFoundMessage(inputVaultPath));
    }

    const outputVaultPath = getOutputPdfPath(inputVaultPath);
    validateVaultPath(outputVaultPath, "Output PDF");

    const vaultBasePath = getVaultBasePath(this.app);
    const inputAbsolutePath = resolveInsideVault(vaultBasePath, inputFile.path);
    const outputAbsolutePath = resolveInsideVault(vaultBasePath, outputVaultPath);

    return {
      vaultBasePath,
      inputVaultPath: inputFile.path,
      outputVaultPath,
      inputAbsolutePath,
      outputAbsolutePath,
      workingDirectory: path.dirname(inputAbsolutePath)
    };
  }

  private getTypstCommand(): string {
    return this.settings.typstCommand.trim() || DEFAULT_SETTINGS.typstCommand;
  }

  private getBookRootPath(): string {
    const inputPath = this.getMainTypstPath();
    const lastSlash = inputPath.lastIndexOf("/");
    return lastSlash === -1 ? "" : inputPath.slice(0, lastSlash);
  }

  private getMainInputCandidates(): string[] {
    const mainPath = this.getMainTypstPath();
    if (mainPath.toLowerCase().endsWith(".typ")) {
      return [mainPath, `${mainPath}.md`];
    }
    return [mainPath];
  }

  private isInBookRoot(vaultPath: string): boolean {
    const bookRoot = this.getBookRootPath();
    return bookRoot === "" || vaultPath.startsWith(`${bookRoot}/`);
  }

  private notFoundMessage(inputVaultPath: string): string {
    const checkedPaths = this.getMainInputCandidates().join(", ");
    if (inputVaultPath.toLowerCase().endsWith(".typ")) {
      return `Main Typst file was not found in the vault. Checked: ${checkedPaths}. If you created it with Obsidian's New note command, it may exist on disk as ${inputVaultPath}.md.`;
    }
    return `Main Typst file was not found in the vault: ${inputVaultPath}`;
  }
}

class TypstToolbarManager {
  private plugin: TypstBookPreviewPlugin;
  private app: App;
  private toolbarEl: HTMLElement | null = null;

  constructor(plugin: TypstBookPreviewPlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  start(): void {
    this.plugin.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refresh()));
    this.plugin.registerEvent(this.app.workspace.on("file-open", () => this.refresh()));
    this.plugin.registerEvent(this.app.workspace.on("layout-change", () => this.refresh()));
    this.app.workspace.onLayoutReady(() => this.refresh());
  }

  refresh(): void {
    this.removeToolbar();
    if (!this.plugin.settings.showTypstToolbar) {
      return;
    }

    const view = this.getActiveTypstView();
    if (!view) {
      return;
    }

    const contentEl = view.containerEl.querySelector(".view-content");
    if (!(contentEl instanceof HTMLElement)) {
      return;
    }

    this.toolbarEl = this.createToolbar();
    contentEl.prepend(this.toolbarEl);
  }

  removeToolbar(): void {
    this.toolbarEl?.remove();
    this.toolbarEl = null;
  }

  private createToolbar(): HTMLElement {
    const toolbarEl = activeDocument.createElement("div");
    toolbarEl.addClass("typst-inline-toolbar");

    let hasVisibleTool = false;
    for (const tool of TYPST_TOOLBAR_TOOLS) {
      if (!this.plugin.isTypstToolbarGroupEnabled(tool.group)) {
        continue;
      }

      if (tool.separatorBefore && hasVisibleTool) {
        toolbarEl.createDiv({ cls: "typst-inline-toolbar-separator" });
      }

      const buttonEl = toolbarEl.createEl("button", {
        cls: "clickable-icon typst-inline-toolbar-button",
        text: tool.label,
        attr: {
          "aria-label": tool.title,
          title: tool.title,
          type: "button"
        }
      });
      buttonEl.addEventListener("mousedown", (event: MouseEvent) => event.preventDefault());
      buttonEl.addEventListener("click", () => this.applyTool(tool));
      hasVisibleTool = true;
    }

    return toolbarEl;
  }

  private applyTool(tool: TypstToolbarTool): void {
    const view = this.getActiveTypstView();
    if (!view) {
      new Notice("Open a .typ or .typ.md file in source mode first.");
      return;
    }

    const editor = view.editor;
    if (tool.kind === "insert") {
      this.applyInsertTool(tool, editor);
    } else if (tool.kind === "line-prefix") {
      this.applyLinePrefixTool(tool, editor);
    } else {
      this.applyWrapTool(tool, editor);
    }

    editor.focus();
  }

  private applyWrapTool(tool: TypstToolbarTool, editor: Editor): void {
    const prefix = tool.prefix ?? "";
    const suffix = tool.suffix ?? "";
    const cursor = editor.getCursor("from");
    const startOffset = editor.posToOffset(cursor);
    const selection = editor.getSelection();
    editor.replaceSelection(`${prefix}${selection}${suffix}`);

    if (!selection || tool.cursorOffset !== undefined) {
      editor.setCursor(editor.offsetToPos(startOffset + (tool.cursorOffset ?? prefix.length)));
    }
  }

  private applyInsertTool(tool: TypstToolbarTool, editor: Editor): void {
    const cursor = editor.getCursor("from");
    const startOffset = editor.posToOffset(cursor);
    const text = tool.text ?? "";
    editor.replaceSelection(text);

    if (tool.cursorOffset !== undefined) {
      editor.setCursor(editor.offsetToPos(startOffset + tool.cursorOffset));
    }
  }

  private applyLinePrefixTool(tool: TypstToolbarTool, editor: Editor): void {
    const linePrefix = tool.linePrefix ?? "";
    const selection = editor.getSelection();
    if (selection) {
      editor.replaceSelection(prefixSelectedLines(selection, linePrefix));
      return;
    }

    const cursor = editor.getCursor("from");
    editor.replaceRange(linePrefix, { line: cursor.line, ch: 0 });
    editor.setCursor({ line: cursor.line, ch: cursor.ch + linePrefix.length });
  }

  private getActiveTypstView(): MarkdownView | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.getMode() !== "source" || !view.file || !isTypstSourcePath(view.file.path)) {
      return null;
    }

    return view;
  }
}

function prefixSelectedLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => line.length === 0 ? line : `${prefix}${line}`)
    .join("\n");
}

class TypstBookPreviewView extends ItemView {
  private plugin: TypstBookPreviewPlugin;
  private statusEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private frameEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: TypstBookPreviewPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TYPST_BOOK_PREVIEW;
  }

  getDisplayText(): string {
    return "Typst Book Preview";
  }

  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("typst-book-preview-view");

    const toolbarEl = container.createDiv({ cls: "typst-book-preview-toolbar" });
    toolbarEl.createDiv({
      cls: "typst-book-preview-title",
      text: "Typst Book Preview"
    });

    const compileButton = toolbarEl.createEl("button", {
      cls: "clickable-icon typst-book-preview-compile-button",
      attr: {
        "aria-label": "Compile Typst Book",
        title: "Compile Typst Book"
      }
    });
    compileButton.createSpan({ text: "Compile" });
    this.registerDomEvent(compileButton, "click", () => {
      void this.plugin.compile("manual");
    });

    this.statusEl = container.createDiv({ cls: "typst-book-preview-status" });
    this.errorEl = container.createDiv({ cls: "typst-book-preview-errors" });
    this.frameEl = container.createDiv({ cls: "typst-book-preview-frame" });

    this.render();
  }

  render(): void {
    if (!this.statusEl || !this.errorEl || !this.frameEl) {
      return;
    }

    const state = this.plugin.state;
    this.statusEl.setText(formatStatus(state));
    this.statusEl.toggleClass("is-compiling", state.status === "compiling");
    this.statusEl.toggleClass("is-error", state.status === "error");
    this.statusEl.toggleClass("is-success", state.status === "success");

    this.renderCompilerOutput(state);
    this.renderPdf(state);
  }

  private renderCompilerOutput(state: CompileState): void {
    if (!this.errorEl) {
      return;
    }

    this.errorEl.empty();
    if (!state.errorText) {
      this.errorEl.hide();
      return;
    }

    this.errorEl.show();
    this.errorEl.toggleClass("is-error", state.status === "error");
    this.errorEl.toggleClass("is-output", state.status !== "error");

    const headerEl = this.errorEl.createDiv({ cls: "typst-book-preview-errors-header" });
    headerEl.createDiv({
      cls: "typst-book-preview-errors-heading",
      text: state.status === "error" ? "Compile problem" : "Compiler output"
    });

    const actionsEl = headerEl.createDiv({ cls: "typst-book-preview-error-actions" });
    this.createActionButton(actionsEl, "Compile again", () => {
      void this.plugin.compile("manual");
    });
    this.createActionButton(actionsEl, "Use active file", () => {
      const activeFile = this.app.workspace.getActiveFile();
      if (!activeFile || !isTypstSourcePath(activeFile.path)) {
        new Notice("Open a .typ or .typ.md file first.");
        return;
      }
      void this.plugin.setMainTypstPath(activeFile.path);
      new Notice(`Typst Book Preview: main file set to ${activeFile.path}`);
    });
    this.createActionButton(actionsEl, "Settings", () => {
      openPluginSettings(this.app);
    });

    const summaryEl = this.errorEl.createDiv({ cls: "typst-book-preview-error-summary" });
    summaryEl.createDiv({ text: `Main file: ${this.plugin.getMainTypstPath()}` });
    summaryEl.createDiv({ text: `Output PDF: ${this.plugin.getOutputPdfPath()}` });
    summaryEl.createDiv({ text: `Typst command: ${this.plugin.getDisplayTypstCommand()}` });

    this.errorEl.createEl("pre", { text: state.errorText });
  }

  private createActionButton(container: HTMLElement, text: string, onClick: () => void): void {
    const button = container.createEl("button", {
      cls: "typst-book-preview-error-button",
      text
    });
    this.registerDomEvent(button, "click", onClick);
  }

  private renderPdf(state: CompileState): void {
    if (!this.frameEl) {
      return;
    }

    this.frameEl.empty();

    if (!state.pdfPath) {
      this.frameEl.createDiv({
        cls: "typst-book-preview-empty",
        text: `No PDF preview yet. Compile ${this.plugin.getMainTypstPath()} to create ${this.plugin.getOutputPdfPath()}.`
      });
      return;
    }

    const resourcePath = getPdfResourcePath(this.app, state.pdfPath);
    if (!resourcePath) {
      this.frameEl.createDiv({
        cls: "typst-book-preview-empty",
        text: `Compiled PDF was not found in the vault: ${state.pdfPath}`
      });
      return;
    }

    const separator = resourcePath.includes("?") ? "&" : "?";
    this.frameEl.createEl("iframe", {
      attr: {
        src: `${resourcePath}${separator}typst-book-preview=${state.updatedAt ?? Date.now()}`,
        title: "Typst PDF preview"
      }
    });
  }
}

class TypstBookPreviewSettingTab extends PluginSettingTab {
  plugin: TypstBookPreviewPlugin;

  constructor(app: App, plugin: TypstBookPreviewPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "General",
        items: [
          {
            name: "Typst CLI command",
            desc: "Command or absolute path to the local Typst CLI. Arguments are passed separately without a shell.",
            control: {
              type: "text",
              key: "typstCommand",
              defaultValue: DEFAULT_SETTINGS.typstCommand,
              placeholder: DEFAULT_SETTINGS.typstCommand
            }
          },
          {
            name: "Main Typst file",
            desc: "Vault-relative path to the book entry file. Search existing .typ and .typ.md files.",
            control: {
              type: "file",
              key: "mainTypstPath",
              defaultValue: DEFAULT_SETTINGS.mainTypstPath,
              placeholder: DEFAULT_SETTINGS.mainTypstPath,
              filter: (file: TFile) => isTypstSourcePath(file.path)
            }
          },
          {
            name: "Typst styling toolbar",
            desc: "Show formatting buttons above source-mode .typ and .typ.md notes.",
            control: {
              type: "toggle",
              key: "showTypstToolbar",
              defaultValue: DEFAULT_SETTINGS.showTypstToolbar
            }
          }
        ]
      },
      {
        type: "group",
        heading: "Typst toolbar groups",
        items: TYPST_TOOLBAR_GROUP_OPTIONS.map((group) => ({
          name: group.name,
          desc: group.description,
          control: {
            type: "toggle",
            key: toolbarGroupSettingKey(group.id),
            defaultValue: DEFAULT_TOOLBAR_GROUPS[group.id]
          }
        }))
      },
      {
        type: "group",
        heading: "Preview pane",
        items: [
          {
            name: "Open preview",
            desc: "Open the PDF preview pane.",
            action: () => {
              void this.plugin.activateView();
            }
          },
          {
            name: "Use active file",
            desc: "Use the active .typ or .typ.md file as the main Typst file.",
            action: () => {
              const activeFile = this.app.workspace.getActiveFile();
              if (!activeFile || !isTypstSourcePath(activeFile.path)) {
                new Notice("Open a .typ or .typ.md file first.");
                return;
              }
              void this.plugin.setMainTypstPath(activeFile.path);
            }
          },
          {
            name: "Compile now",
            desc: "Compile the configured Typst file.",
            action: () => {
              void this.plugin.compile("manual");
            }
          }
        ]
      }
    ];
  }

  getControlValue(key: string): unknown {
    const toolbarGroup = toolbarGroupFromSettingKey(key);
    if (toolbarGroup) {
      return this.plugin.isTypstToolbarGroupEnabled(toolbarGroup);
    }

    return super.getControlValue(key);
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const toolbarGroup = toolbarGroupFromSettingKey(key);
    if (toolbarGroup) {
      this.plugin.settings.toolbarGroups[toolbarGroup] = value === true;
      await this.plugin.saveSettings();
      this.plugin.refreshTypstToolbar();
      return;
    }

    if (key === "typstCommand") {
      this.plugin.settings.typstCommand = String(value ?? "").trim() || DEFAULT_SETTINGS.typstCommand;
      await this.plugin.saveSettings();
      return;
    }

    if (key === "mainTypstPath") {
      await this.plugin.setMainTypstPath(String(value ?? "").trim() || DEFAULT_SETTINGS.mainTypstPath);
      return;
    }

    if (key === "showTypstToolbar") {
      this.plugin.settings.showTypstToolbar = value === true;
      await this.plugin.saveSettings();
      this.plugin.refreshTypstToolbar();
      return;
    }

    await super.setControlValue(key, value);
  }
}

function toolbarGroupSettingKey(group: TypstToolbarGroup): string {
  return `toolbarGroups.${group}`;
}

function toolbarGroupFromSettingKey(key: string): TypstToolbarGroup | null {
  const prefix = "toolbarGroups.";
  if (!key.startsWith(prefix)) {
    return null;
  }

  const group = key.slice(prefix.length) as TypstToolbarGroup;
  return group in DEFAULT_TOOLBAR_GROUPS ? group : null;
}

class TypstCommandError extends Error {
  stdout: string;
  stderr: string;

  constructor(message: string, stdout: string, stderr: string) {
    super(message);
    this.name = "TypstCommandError";
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

function execFilePromise(
  command: string,
  args: string[],
  options: ExecFileOptionsWithStringEncoding
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new TypstCommandError(error.message, stdout ?? "", stderr ?? ""));
        return;
      }

      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? ""
      });
    });
  });
}

function compilerErrorToString(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return errorToString(error);
  }

  const execError = error as ExecFileException & { stdout?: string; stderr?: string };
  const compilerOutput = [execError.stderr, execError.stdout].filter(Boolean).join("\n").trim();
  if (compilerOutput) {
    return compilerOutput;
  }

  return execError.message || "Typst failed without compiler output.";
}

function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function formatStatus(state: CompileState): string {
  const suffix = state.updatedAt ? ` (${new Date(state.updatedAt).toLocaleTimeString()})` : "";
  return `${state.message}${suffix}`;
}

function isTypstSourcePath(vaultPath: string): boolean {
  return /\.typ(?:\.md)?$/i.test(vaultPath);
}

function isImageAssetPath(vaultPath: string): boolean {
  const extension = vaultPath.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(extension);
}

function getOutputPdfPath(inputVaultPath: string): string {
  return inputVaultPath.replace(/\.typ(?:\.md)?$/i, ".pdf");
}

function openPluginSettings(app: App): void {
  const setting = (app as App & {
    setting?: {
      open: () => void;
      openTabById: (id: string) => void;
    };
  }).setting;

  if (!setting) {
    new Notice("Open Settings > Typst Book Preview.");
    return;
  }

  setting.open();
  setting.openTabById("typst-book-preview");
}

function getVaultBasePath(app: App): string {
  const adapter = app.vault.adapter as { getBasePath?: () => string };
  const basePath = adapter.getBasePath?.();
  if (!basePath) {
    throw new Error("Typst Book Preview requires the desktop file-system vault adapter.");
  }
  return basePath;
}

function getPdfResourcePath(app: App, vaultPath: string): string | null {
  const adapter = app.vault.adapter as { getResourcePath?: (normalizedPath: string) => string };
  if (adapter.getResourcePath) {
    return adapter.getResourcePath(vaultPath);
  }

  const file = app.vault.getAbstractFileByPath(vaultPath);
  return file instanceof TFile ? app.vault.getResourcePath(file) : null;
}

function resolveInsideVault(vaultBasePath: string, vaultPath: string): string {
  const vaultRoot = path.resolve(vaultBasePath);
  const resolvedPath = path.resolve(vaultRoot, vaultPath);
  if (resolvedPath !== vaultRoot && !resolvedPath.startsWith(`${vaultRoot}${path.sep}`)) {
    throw new Error(`Path escapes the vault: ${vaultPath}`);
  }
  return resolvedPath;
}

function validateVaultPath(vaultPath: string, label: string): void {
  if (!vaultPath) {
    throw new Error(`${label} is required.`);
  }

  if (path.isAbsolute(vaultPath) || vaultPath === "." || vaultPath === ".." || vaultPath.startsWith("../") || vaultPath.includes("/../")) {
    throw new Error(`${label} must be a vault-relative path.`);
  }
}
