import { App, CachedMetadata, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, normalizePath } from 'obsidian';
import { dirname, relative } from './lib/path';
import {
    ParsedMarkdownLink,
    TextReplacement,
    applyReplacements,
    buildLinkTarget,
    formatMarkdownLink,
    hasParentSegment,
    isImageExtension,
    lastFolderName,
    nextAvailablePath,
    parseMarkdownLink,
    linkLookupCandidates,
    mentionsFileName,
    splitSubpath,
    stripWidthSuffix,
    jsonStringValues,
} from './lib/link';

interface UpdateRelativeLinksSettings {
    normalizeTitles: boolean;
    autoAppendImageWidth: boolean;
    imageWidthSuffix: string;
    copyEmbeddedAssets: boolean;
    assetMirrorFolder: string;
    dryRunNoticeLimit: number;
    verboseLogging: boolean;
}

const DEFAULT_SETTINGS: UpdateRelativeLinksSettings = {
    normalizeTitles: true,
    autoAppendImageWidth: true,
    imageWidthSuffix: '650',
    copyEmbeddedAssets: true,
    assetMirrorFolder: '_assets',
    dryRunNoticeLimit: 5,
    verboseLogging: false,
};

interface Replacement {
    original: string;
    updated: string;
    reason: string;
}

interface ProcessOptions {
    dryRun?: boolean;
    /** 이동 이벤트에서 넘어온 이전 경로. 링크를 이전 위치 기준으로도 해석한다. */
    oldPath?: string;
}

interface ProcessResult {
    file: TFile;
    count: number;
    dryRun: boolean;
    replacements: Replacement[];
}

class ConfirmModal extends Modal {
    constructor(
        app: App,
        private readonly message: string,
        private readonly onConfirm: () => void,
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h1', { text: 'Update Relative Links' });
        contentEl.createEl('p', { text: this.message });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Run command')
                .setCta()
                .onClick(() => {
                    this.close();
                    this.onConfirm();
                }))
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()));
    }
}

type SettingsProvider = () => UpdateRelativeLinksSettings;

export default class UpdateRelativeLinksPlugin extends Plugin {
    private settings: UpdateRelativeLinksSettings;
    private processor: LinkProcessor;
    private renameTimers = new Map<string, number>();

    async onload() {
        await this.loadSettings();
        this.processor = new LinkProcessor(this.app, () => this.settings);

        this.addCommand({
            id: 'update-all-relative-links',
            name: 'Update all relative links',
            callback: () => this.requestVaultWideRun(false),
        });

        this.addCommand({
            id: 'preview-relative-link-updates',
            name: 'Preview relative link updates (dry run)',
            callback: () => this.requestVaultWideRun(true),
        });

        this.addCommand({
            id: 'update-relative-links-current-file',
            name: 'Update relative links in current file',
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!(file instanceof TFile)) {
                    return false;
                }

                if (!checking) {
                    this.runForSingleFile(file);
                }
                return true;
            }
        });

        this.addCommand({
            id: 'update-relative-links-current-folder',
            name: 'Update relative links in current folder',
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                const folderPath = file?.parent?.path ?? '/';

                if (!(file instanceof TFile)) {
                    return false;
                }

                if (!checking) {
                    this.runForFolder(folderPath, file.parent?.name ?? 'vault root');
                }
                return true;
            }
        });

        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (!oldPath || !(file instanceof TFile)) {
                return;
            }

            const movedWithinSameDir = file.parent?.path === dirname(oldPath);
            if (movedWithinSameDir) {
                return;
            }

            this.queueFileProcessing(file, oldPath);
        }));

        this.addSettingTab(new UpdateRelativeLinksSettingTab(this.app, this));

        this.addRibbonIcon('link', 'Update all relative links', () => this.requestVaultWideRun(false));
        this.addRibbonIcon('eye', 'Preview relative link updates', () => this.requestVaultWideRun(true));
        this.addRibbonIcon('file-text', 'Update current file links', () => {
            const file = this.app.workspace.getActiveFile();
            if (file instanceof TFile) {
                this.runForSingleFile(file);
            } else {
                new Notice('No active file to update.');
            }
        });
        this.addRibbonIcon('folder', 'Update links in current folder', () => {
            const file = this.app.workspace.getActiveFile();
            if (file instanceof TFile) {
                const folderPath = file.parent?.path ?? '/';
                this.runForFolder(folderPath, file.parent?.name ?? 'vault root');
            } else {
                new Notice('No active file to derive folder from.');
            }
        });
    }

    private async runForSingleFile(file: TFile) {
        try {
            const result = await this.processor.processFile(file, { dryRun: false });
            if (result.count > 0) {
                new Notice(`Updated ${result.count} link${result.count === 1 ? '' : 's'} in ${file.name}.`);
            } else {
                new Notice(`No link updates needed in ${file.name}.`);
            }
        } catch (error) {
            console.error(`[UpdateRelativeLinks] Failed to update ${file.path}`, error);
            new Notice(`Failed to update ${file.name}, check console for details.`);
        }
    }

    private async runForFolder(folderPath: string, label: string) {
        const files = this.app.vault.getMarkdownFiles()
            .filter(f => (f.parent?.path ?? '/') === folderPath);

        if (!files.length) {
            new Notice(`No markdown files found in ${label}.`);
            return;
        }

        let total = 0;
        let touched = 0;
        for (const file of files) {
            try {
                const result = await this.processor.processFile(file, { dryRun: false });
                if (result.count > 0) {
                    touched += 1;
                    total += result.count;
                    console.log(`[UpdateRelativeLinks] ${file.path}: ${result.count} change(s)`);
                }
            } catch (error) {
                console.error(`[UpdateRelativeLinks] Failed to update ${file.path}`, error);
            }
        }

        if (touched === 0) {
            new Notice(`No link updates needed in ${label}.`);
        } else {
            new Notice(`Updated ${total} links across ${touched} file${touched === 1 ? '' : 's'} in ${label}.`);
        }
    }

    onunload() {
        this.renameTimers.forEach(timer => window.clearTimeout(timer));
        this.renameTimers.clear();
    }

    private requestVaultWideRun(dryRun: boolean) {
        const kind = dryRun ? 'This will preview changes without writing files.' : 'This will modify every Markdown file in the vault.';
        const message = `${kind} Back up your vault before continuing.`;
        new ConfirmModal(this.app, message, () => this.runAcrossVault(dryRun)).open();
    }

    private async runAcrossVault(dryRun: boolean) {
        const files = this.app.vault.getMarkdownFiles();
        let totalLinks = 0;
        let touchedFiles = 0;
        const previews: string[] = [];
        const updatedFiles: string[] = [];

        for (const file of files) {
            try {
                const result = await this.processor.processFile(file, { dryRun });
                if (result.count > 0) {
                    touchedFiles += 1;
                    totalLinks += result.count;
                    const summary = `${file.path}: ${result.count} change(s)`;
                    if (dryRun) {
                        if (previews.length < this.settings.dryRunNoticeLimit) {
                            previews.push(summary);
                        }
                    } else {
                        updatedFiles.push(summary);
                    }
                }
            } catch (error) {
                console.error(`[UpdateRelativeLinks] Failed to process ${file.path}`, error);
                new Notice(`Failed to update ${file.name}, check console for details.`);
            }
        }

        if (dryRun) {
            if (touchedFiles === 0) {
                new Notice('Dry run complete. No files require changes.');
            } else {
                const extra = touchedFiles > previews.length ? ` …and ${touchedFiles - previews.length} more.` : '';
                const body = previews.join('\n');
                new Notice(`Dry run ready: ${totalLinks} changes in ${touchedFiles} files.\n${body}${extra}`);
            }
        } else {
            if (updatedFiles.length) {
                console.log('[UpdateRelativeLinks] Updated files:\n' + updatedFiles.join('\n'));
            }
            new Notice(`Updated ${totalLinks} links across ${touchedFiles} file${touchedFiles === 1 ? '' : 's'}.`);
        }
    }

    private queueFileProcessing(file: TFile, oldPath: string) {
        const existing = this.renameTimers.get(file.path);
        if (existing) {
            window.clearTimeout(existing);
        }

        const timer = window.setTimeout(async () => {
            this.renameTimers.delete(file.path);
            try {
                const result = await this.processor.processFile(file, { dryRun: false, oldPath });
                if (result.count > 0) {
                    new Notice(`Updated ${result.count} link${result.count === 1 ? '' : 's'} in ${file.name}.`);
                }
            } catch (error) {
                console.error(`[UpdateRelativeLinks] Failed to update ${file.path}`, error);
            }
        }, 200);

        this.renameTimers.set(file.path, timer);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    getSettings() {
        return this.settings;
    }

    getProcessor() {
        return this.processor;
    }
}

class UpdateRelativeLinksSettingTab extends PluginSettingTab {
    constructor(app: App, private plugin: UpdateRelativeLinksPlugin) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Update Relative Links' });

        new Setting(containerEl)
            .setName('Normalize link titles')
            .setDesc('Rebuild empty or path-based titles using target file names.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.getSettings().normalizeTitles)
                .onChange(async value => {
                    this.plugin.getSettings().normalizeTitles = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto append image width')
            .setDesc('Append "|650" (or custom) to embedded image titles.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.getSettings().autoAppendImageWidth)
                .onChange(async value => {
                    this.plugin.getSettings().autoAppendImageWidth = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Image width suffix')
            .setDesc('Used when auto appending image width.')
            .addText(text => text
                .setPlaceholder('650')
                .setValue(this.plugin.getSettings().imageWidthSuffix)
                .onChange(async value => {
                    this.plugin.getSettings().imageWidthSuffix = value || DEFAULT_SETTINGS.imageWidthSuffix;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Copy embedded assets locally')
            .setDesc('Copy files embedded with "../" into a folder under the current note directory. The original is moved to the vault .trash folder only when no other note references it. A source folder left empty is removed.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.getSettings().copyEmbeddedAssets)
                .onChange(async value => {
                    this.plugin.getSettings().copyEmbeddedAssets = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Asset mirror subfolder')
            .setDesc('Used when the embed path has no folder name (e.g. ../image.png). Otherwise the last folder name of the path is kept.')
            .addText(text => text
                .setPlaceholder('_assets')
                .setValue(this.plugin.getSettings().assetMirrorFolder)
                .onChange(async value => {
                    this.plugin.getSettings().assetMirrorFolder = value || DEFAULT_SETTINGS.assetMirrorFolder;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Dry run preview limit')
            .setDesc('Maximum number of file summaries shown in dry-run notices.')
            .addSlider(slider => slider
                .setLimits(1, 20, 1)
                .setValue(this.plugin.getSettings().dryRunNoticeLimit)
                .setDynamicTooltip()
                .onChange(async value => {
                    this.plugin.getSettings().dryRunNoticeLimit = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Verbose logging')
            .setDesc('Log every replacement to the developer console.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.getSettings().verboseLogging)
                .onChange(async value => {
                    this.plugin.getSettings().verboseLogging = value;
                    await this.plugin.saveSettings();
                }));
    }
}

interface LinkPlan {
    original: string;
    start: number;
    end: number;
    parsed: ParsedMarkdownLink;
    destination: TFile;
    /** 미러링할 대상 경로(계획 값). 실행 시 이미 다른 파일이 있으면 새 이름으로 바뀐다. */
    mirrorPath: string | null;
}

class LinkProcessor {
    private locks = new Map<string, Promise<unknown>>();
    private trashQueue: Promise<void> = Promise.resolve();

    constructor(private readonly app: App, private readonly getSettings: SettingsProvider) { }

    /** 같은 파일에 대한 처리(수동 실행·이동 이벤트)를 순서대로 실행한다. */
    processFile(file: TFile, options: ProcessOptions): Promise<ProcessResult> {
        const previous = this.locks.get(file.path) ?? Promise.resolve();
        const run = previous.catch(() => undefined).then(() => this.processFileUnlocked(file, options));
        this.locks.set(file.path, run);
        const cleanup = () => {
            if (this.locks.get(file.path) === run) {
                this.locks.delete(file.path);
            }
        };
        run.then(cleanup, cleanup);
        return run;
    }

    private async processFileUnlocked(file: TFile, options: ProcessOptions): Promise<ProcessResult> {
        const dryRun = !!options.dryRun;
        const empty: ProcessResult = { file, count: 0, dryRun, replacements: [] };
        const metadata = this.app.metadataCache.getFileCache(file);
        if (!metadata) {
            return empty;
        }

        const plans = this.planLinks(file, metadata, options.oldPath);
        if (!plans.length) {
            return empty;
        }

        // dry run은 파일 시스템을 바꾸지 않는다. 미러 경로는 계획 값으로만 보여준다.
        const resolvedPaths = new Map<LinkPlan, string>();
        for (const plan of plans) {
            let targetPath = plan.destination.path;
            if (plan.mirrorPath) {
                targetPath = dryRun ? plan.mirrorPath : (await this.copyAsset(plan.destination, plan.mirrorPath)) ?? targetPath;
            }
            resolvedPaths.set(plan, targetPath);
        }

        const pending: (TextReplacement & { reason: string })[] = [];
        for (const plan of plans) {
            const targetPath = resolvedPaths.get(plan) ?? plan.destination.path;
            const updated = this.buildUpdatedLink(file, plan, targetPath);
            if (updated !== plan.original) {
                const reason = `${plan.parsed.isEmbed ? 'embed' : 'link'}-adjustment${targetPath !== plan.destination.path ? '+mirror' : ''}`;
                pending.push({ start: plan.start, end: plan.end, original: plan.original, updated, reason });
            }
        }

        if (!pending.length) {
            return empty;
        }
        if (dryRun) {
            return { file, count: pending.length, dryRun: true, replacements: pending.map(this.toReplacement) };
        }

        let applied: (TextReplacement & { reason: string })[] = [];
        await this.app.vault.process(file, data => {
            const result = applyReplacements(data, pending);
            applied = result.applied as (TextReplacement & { reason: string })[];
            if (result.skipped.length) {
                console.warn(`[UpdateRelativeLinks] ${file.path}: ${result.skipped.length} link(s) skipped because the file changed after indexing.`);
            }
            return result.content;
        });

        await this.trashOrphanedSources(file, metadata, options.oldPath, plans, resolvedPaths, applied);

        if (this.getSettings().verboseLogging) {
            applied.forEach(r => {
                console.log(`[UpdateRelativeLinks] ${file.path}: ${r.reason}\n- from: ${r.original}\n- to:   ${r.updated}`);
            });
        }
        return { file, count: applied.length, dryRun: false, replacements: applied.map(this.toReplacement) };
    }

    /**
     * 복사한 원본을 더 이상 아무 곳에서도 쓰지 않으면 볼트 휴지통(.trash)으로 보낸다(복원 가능).
     * 판단이 어려우면 항상 남긴다. 다음 중 하나라도 해당하면 지우지 않는다.
     * - 이 노트에서 원본을 가리키는 다른 참조(위키링크·frontmatter·건너뛴 링크·복사 실패)가 있다.
     * - 이 노트(바꾼 링크 제외)나 다른 파일(.md·.canvas, 열린 편집기의 저장 전 내용 포함)의 본문에 원본 파일명이 나온다.
     *   링크 색인이 늦게 갱신되거나 색인에 없는 참조(캔버스·미해결 링크)도 막으려고 본문을 직접 검색한다.
     * 정리 작업은 플러그인 전체에서 하나씩 순서대로 실행한다.
     */
    private trashOrphanedSources(file: TFile, metadata: CachedMetadata, oldPath: string | undefined, plans: LinkPlan[], resolvedPaths: Map<LinkPlan, string>, applied: TextReplacement[]): Promise<void> {
        const run = this.trashQueue.catch(() => undefined).then(() => this.trashOrphanedSourcesUnlocked(file, metadata, oldPath, plans, resolvedPaths, applied));
        this.trashQueue = run;
        return run;
    }

    private async trashOrphanedSourcesUnlocked(file: TFile, metadata: CachedMetadata, oldPath: string | undefined, plans: LinkPlan[], resolvedPaths: Map<LinkPlan, string>, applied: TextReplacement[]) {
        // 복사하고 링크까지 바꾼 위치(시작 오프셋)만 '원본을 더 쓰지 않는 참조'로 본다.
        const appliedStarts = new Set(applied.map(r => r.start));
        const movedAway = new Set<number>();
        const copied = new Map<string, TFile>();
        const copyTargets = new Map<string, Set<string>>();
        for (const plan of plans) {
            const target = resolvedPaths.get(plan) ?? plan.destination.path;
            if (target !== plan.destination.path && appliedStarts.has(plan.start)) {
                movedAway.add(plan.start);
                copied.set(plan.destination.path, plan.destination);
                copyTargets.set(plan.destination.path, (copyTargets.get(plan.destination.path) ?? new Set()).add(target));
            }
        }
        if (!copied.size) {
            return;
        }

        // ⓪ Obsidian이 새 링크를 실제로 복사본으로 해석하는지 색인으로 확인한다.
        //    (예: Obsidian은 링크의 '&copy;'를 '©'로 읽고 '%26'은 풀지 않는다.) 확인하지 못하면 원본을 남긴다.
        const allTargets = [...copyTargets.values()].flatMap(set => [...set]);
        await this.waitForResolved(file, allTargets);
        const resolvedNow = this.resolvedTargets(file);
        for (const [sourcePath, targets] of copyTargets) {
            if (![...targets].every(t => resolvedNow.has(t))) {
                console.warn(`[UpdateRelativeLinks] ${file.path}: new link to the copy of ${sourcePath} does not resolve, keeping original`);
                copied.delete(sourcePath);
            }
        }
        if (!copied.size) {
            return;
        }

        // ① 같은 노트의 모든 참조(링크·임베드·frontmatter)를 다시 해석한다.
        const stillUsed = new Set<string>();
        const entries: { link: string; start?: number }[] = [
            ...[...(metadata.links ?? []), ...(metadata.embeds ?? [])].map(e => ({ link: e.link, start: e.position?.start.offset })),
            ...(metadata.frontmatterLinks ?? []).map(e => ({ link: e.link })),
        ];
        for (const entry of entries) {
            if (entry.start !== undefined && movedAway.has(entry.start)) {
                continue;
            }
            const linkPath = splitSubpath(entry.link).path;
            for (const source of oldPath ? [file.path, oldPath] : [file.path]) {
                for (const candidate of linkLookupCandidates(linkPath)) {
                    const dest = this.app.metadataCache.getFirstLinkpathDest(candidate, source);
                    if (dest && copied.has(dest.path)) {
                        stillUsed.add(dest.path);
                    }
                }
            }
        }

        for (const source of copied.values()) {
            if (stillUsed.has(source.path) || await this.isNameMentioned(source, file, applied)) {
                continue;
            }
            const folder = source.parent;
            try {
                await this.app.vault.trash(source, false);
                console.log(`[UpdateRelativeLinks] ${file.path}: moved unreferenced original ${source.path} to .trash`);
            } catch (error) {
                console.error('[UpdateRelativeLinks] Failed to trash original asset', error);
                continue;
            }
            await this.removeEmptyFolder(folder);
        }
    }

    /**
     * 노트의 현재 색인(links·embeds·frontmatterLinks)이 가리키는 파일 경로를 모은다.
     * 지금 해석 규칙(getFirstLinkpathDest)으로 다시 찾는다. 같은 경로의 다른 파일이 생기면 그쪽으로 해석될 수 있기 때문이다.
     */
    private resolvedTargets(file: TFile): Set<string> {
        const cache = this.app.metadataCache.getFileCache(file);
        const refs = [...(cache?.links ?? []), ...(cache?.embeds ?? []), ...(cache?.frontmatterLinks ?? [])];
        const out = new Set<string>();
        for (const ref of refs) {
            const dest = this.app.metadataCache.getFirstLinkpathDest(splitSubpath(ref.link).path, file.path);
            if (dest) {
                out.add(dest.path);
            }
        }
        return out;
    }

    /**
     * 노트의 색인이 갱신되어 대상 경로가 모두 해석될 때까지 기다린다(최대 5초).
     * 창이 백그라운드이면 타이머가 크게 늦어지므로(Chromium 타이머 제한) 반복 횟수가 아니라 실제 경과 시간으로 끝낸다.
     */
    private async waitForResolved(file: TFile, targets: string[]): Promise<void> {
        const done = () => {
            const resolved = this.resolvedTargets(file);
            return targets.every(t => resolved.has(t));
        };
        const deadline = Date.now() + 5000;
        while (!done() && Date.now() < deadline) {
            await new Promise(resolve => window.setTimeout(resolve, 100));
        }
    }

    /**
     * .md·.canvas 파일 본문(디스크와 열린 편집기의 저장 전 내용)에 원본 파일명이 나오는지 확인한다. 오류가 나면 '나온다'로 본다.
     * 현재 노트도 검사한다. 이때는 이번에 바꾼 링크를 하나에 한 번씩만 빼고 본다.
     * (편집기는 vault.process 직후 잠시 바뀌기 전 내용을 보일 수 있다. 저장 전 편집 내용은 편집기에만 있다.)
     * 그래서 색인 뒤에 추가된 참조나 계획에서 빠진 참조가 남아 있으면 원본을 지우지 않는다.
     */
    private async isNameMentioned(source: TFile, current: TFile, applied: TextReplacement[]): Promise<boolean> {
        const check = (path: string, text: string) => {
            if (path === current.path) {
                // 바꾼 링크 하나마다 한 번만 뺀다(바뀐 문자열, 편집기가 아직 옛 내용이면 바뀌기 전 문자열).
                // 같은 문자열의 참조가 나중에 더 추가되었으면 그만큼 남아서 원본을 지키게 된다.
                for (const r of applied) {
                    const at = text.indexOf(r.updated) >= 0 ? text.indexOf(r.updated) : text.indexOf(r.original);
                    const length = text.indexOf(r.updated) >= 0 ? r.updated.length : r.original.length;
                    if (at >= 0) {
                        text = text.slice(0, at) + text.slice(at + length);
                    }
                }
            }
            return mentionsFileName(text, source.name);
        };
        try {
            // Obsidian 색인을 먼저 본다. 다른 파일이 원본을 가리키거나(YAML 이스케이프 등 파서가 푼 표기 포함),
            // 색인된 링크 문자열에 원본 이름이 나오면 원본을 지킨다.
            for (const [path, links] of Object.entries(this.app.metadataCache.resolvedLinks)) {
                if (path !== current.path && links[source.path]) {
                    return true;
                }
            }
            for (const other of this.app.vault.getMarkdownFiles()) {
                if (other.path === current.path) {
                    continue;
                }
                const cache = this.app.metadataCache.getFileCache(other);
                const refs = [...(cache?.links ?? []), ...(cache?.embeds ?? []), ...(cache?.frontmatterLinks ?? [])];
                if (refs.some(ref => mentionsFileName(ref.link, source.name))) {
                    return true;
                }
            }
            for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
                const view = leaf.view as unknown as { file?: TFile; editor?: { getValue(): string } };
                if (view.file && view.editor && check(view.file.path, view.editor.getValue())) {
                    return true;
                }
            }
            for (const other of this.app.vault.getFiles()) {
                if (other.extension !== 'md' && other.extension !== 'canvas') {
                    continue;
                }
                const raw = await this.app.vault.read(other);
                // Canvas는 JSON이라 '\u0061' 같은 이스케이프로도 경로를 쓸 수 있다. 파싱한 문자열 값도 함께 검사한다.
                const body = other.extension === 'canvas' ? raw + '\n' + jsonStringValues(raw) : raw;
                if (check(other.path, body)) {
                    return true;
                }
            }
            return false;
        } catch (error) {
            console.error('[UpdateRelativeLinks] Failed to scan references, keeping original', error);
            return true;
        }
    }

    /**
     * 원본을 보낸 뒤 그 폴더(예: '00. attachments')가 비었으면 지운다. 상위 폴더로는 올라가지 않는다.
     * Node의 rmdir은 폴더가 비어 있을 때만 성공하므로(ENOTEMPTY), 그사이 파일이 생겨도 함께 지워지지 않는다.
     * adapter.rmdir(path, false)는 폴더에 항상 EISDIR로 실패해서 쓰지 않는다. 데스크톱이 아니면 폴더를 남긴다.
     */
    private async removeEmptyFolder(folder: TFolder | null) {
        // 모바일에는 FileSystemAdapter가 없으므로 instanceof 대신 필요한 기능이 있는지만 본다.
        const adapter = this.app.vault.adapter as unknown as {
            fsPromises?: { rmdir(path: string): Promise<void> };
            getFullPath?: (path: string) => string;
        };
        if (!folder || folder.isRoot() || !adapter.fsPromises || typeof adapter.getFullPath !== 'function') {
            return;
        }
        try {
            await adapter.fsPromises.rmdir(adapter.getFullPath(folder.path));
            console.log(`[UpdateRelativeLinks] removed empty folder ${folder.path}`);
        } catch {
            // 비어 있지 않거나 이미 없으면 그대로 둔다.
        }
    }

    private toReplacement(r: TextReplacement & { reason: string }): Replacement {
        return { original: r.original, updated: r.updated, reason: r.reason };
    }

    private planLinks(file: TFile, metadata: CachedMetadata, oldPath?: string): LinkPlan[] {
        const settings = this.getSettings();
        const plans: LinkPlan[] = [];
        const entries = [...(metadata.links ?? []), ...(metadata.embeds ?? [])];

        for (const entry of entries) {
            const original = entry.original;
            if (!original || !entry.position) {
                continue;
            }
            const parsed = parseMarkdownLink(original);
            if (!parsed) {
                continue;
            }
            const { path: rawPath } = splitSubpath(parsed.target);
            const candidates = linkLookupCandidates(rawPath);
            if (!candidates.length || /^[a-z][a-z0-9+.-]*:/i.test(candidates[0])) {
                continue;
            }

            // 현재 위치와(이동 직후면) 이전 위치 기준으로 모두 찾는다. 대상이 하나로 정해질 때만 고친다.
            // 찾지 못하거나 두 위치에서 서로 다른 파일이 찾히면(Obsidian이 이미 고쳤는지 알 수 없음) 손대지 않는다.
            const found = new Map<string, { destination: TFile; linkPath: string }>();
            for (const source of oldPath ? [file.path, oldPath] : [file.path]) {
                for (const candidate of candidates) {
                    const dest = this.app.metadataCache.getFirstLinkpathDest(candidate, source);
                    if (dest && !found.has(dest.path)) {
                        found.set(dest.path, { destination: dest, linkPath: candidate });
                    }
                }
            }
            if (found.size !== 1) {
                if (found.size > 1) {
                    console.warn(`[UpdateRelativeLinks] ${file.path}: skipped ambiguous link ${original}`);
                }
                continue;
            }
            const { destination, linkPath } = [...found.values()][0];

            plans.push({
                original,
                start: entry.position.start.offset,
                end: entry.position.end.offset,
                parsed,
                destination,
                mirrorPath: this.planMirrorPath(file, parsed, linkPath, destination, settings),
            });
        }
        return plans;
    }

    private planMirrorPath(file: TFile, parsed: ParsedMarkdownLink, linkPath: string, destination: TFile, settings: UpdateRelativeLinksSettings): string | null {
        if (!settings.copyEmbeddedAssets || !parsed.isEmbed || destination.extension.toLowerCase() === 'md') {
            return null;
        }
        if (!hasParentSegment(linkPath)) {
            return null;
        }
        // 링크의 마지막 폴더 이름(예: '00. attachments')을 노트 폴더 아래에 만든다. 이름이 없으면('../a.png') 설정값을 쓴다.
        const folder = lastFolderName(linkPath) || settings.assetMirrorFolder;
        const noteDir = file.parent?.path && file.parent.path !== '/' ? file.parent.path : '';
        const target = normalizePath([noteDir, folder, destination.name].filter(Boolean).join('/'));
        return target === destination.path ? null : target;
    }

    /** 원본을 그대로 두고 복사한다(정리는 trashOrphanedSources가 맡는다). 대상에 다른 내용의 파일이 있으면 새 이름을 쓴다. 실패하면 null. */
    private async copyAsset(source: TFile, targetPath: string): Promise<string | null> {
        const vault = this.app.vault;
        try {
            const data = await vault.readBinary(source);
            const existing = vault.getAbstractFileByPath(targetPath);
            if (existing instanceof TFile && this.sameBytes(await vault.readBinary(existing), data)) {
                return targetPath;
            }
            const finalPath = nextAvailablePath(targetPath, p => !!vault.getAbstractFileByPath(p));
            const folder = finalPath.includes('/') ? finalPath.slice(0, finalPath.lastIndexOf('/')) : '';
            if (folder && !vault.getAbstractFileByPath(folder)) {
                await vault.createFolder(folder);
            }
            await vault.createBinary(finalPath, data);
            return finalPath;
        } catch (error) {
            console.error('[UpdateRelativeLinks] Failed to copy asset', error);
            return null;
        }
    }

    private sameBytes(a: ArrayBuffer, b: ArrayBuffer) {
        if (a.byteLength !== b.byteLength) {
            return false;
        }
        const x = new Uint8Array(a);
        const y = new Uint8Array(b);
        for (let i = 0; i < x.length; i++) {
            if (x[i] !== y[i]) {
                return false;
            }
        }
        return true;
    }

    private buildUpdatedLink(file: TFile, plan: LinkPlan, targetPath: string): string {
        const { parsed } = plan;
        const newPath = relative(file.path, targetPath);
        const target = buildLinkTarget(parsed.target, newPath, parsed.angle);
        const altText = this.normalizeAltText(parsed, plan.destination);
        return formatMarkdownLink({ ...parsed, target, altText });
    }

    private normalizeAltText(parsed: ParsedMarkdownLink, destination: TFile): string {
        const settings = this.getSettings();
        if (!settings.normalizeTitles) {
            return parsed.altText;
        }

        const trimmed = parsed.altText.trim();
        if (parsed.isEmbed) {
            if (!isImageExtension(destination.extension)) {
                return trimmed && !trimmed.includes('/') ? parsed.altText : destination.name;
            }
            let base = settings.autoAppendImageWidth ? stripWidthSuffix(trimmed, settings.imageWidthSuffix) : trimmed;
            if (!base || base.includes('/')) {
                base = destination.name;
            }
            const candidate = settings.autoAppendImageWidth ? `${base}|${settings.imageWidthSuffix}` : base;
            return candidate === trimmed ? parsed.altText : candidate;
        }

        if (!trimmed || trimmed.includes('/')) {
            return destination.extension.toLowerCase() === 'md' ? destination.basename : destination.name;
        }
        return parsed.altText;
    }
}
