import { App, Modal, Notice, Plugin, Setting, TFile, FileSystemAdapter } from 'obsidian';
import { dirname, relative } from './lib/path';
import { promises as fs } from 'fs';

class ConfirmModal extends Modal {
    content: string;
    onConfirm: () => void;

    constructor(app: App, content: string, onConfirm: () => void) {
        super(app);

        this.content = content;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl('h1', { text: 'Update Releate Links Plugin' });
        contentEl.createEl('p', { text: this.content });

        new Setting(contentEl)
            .addButton((btn) => btn
                .setButtonText('Yes')
                .setCta()
                .onClick(() => {
                    this.close();
                    this.onConfirm();
                }))
            .addButton((btn) => btn
                .setButtonText('No')
                .onClick(() => {
                    this.close();
                }));
    }

    onClose() {
        this.contentEl.empty();
    }
}

export default class UpdateRelativeLinksPlugin extends Plugin {
    async onload() {
        const { app } = this;
        const { metadataCache, vault } = app;

        const message = '[Renewer] This command will modify all links in the entire vault (not just the current file) to relative paths,'
            + ' and this action cannot be undone.'
            + ' It is recommended that you back up the vault in advance.'
            + ' Please confirm whether you want to execute the command.';

        this.addCommand({
            id: 'update-all-relative-links Renewer',
            name: 'Update all relative links Renewer',
            callback() {
                new ConfirmModal(app, message, () => {
                    const promises = vault.getMarkdownFiles().map(file => replace(vault.adapter as FileSystemAdapter, file, false));

                    Promise.all(promises).then(linkCounts => {
                        const updatedLinkCounts = linkCounts.filter(count => count > 0);

                        const linkCount = updatedLinkCounts.reduce((sum, count) => sum + count, 0);
                        const fileCount = updatedLinkCounts.length;

                        new Notice(`Update ${linkCount} links in ${fileCount} file${fileCount > 1 ? 's' : ''}.`);
                    }).catch(err => {
                        new Notice('Update links error, see console.');
                        console.error(err);
                    });
                }).open();
            }
        });

        this.registerEvent(vault.on('rename', (file, oldPath) => {
            if (!oldPath
                || !file.path.toLocaleLowerCase().endsWith('.md')
                || file.parent?.path === dirname(oldPath)) {
                return;
            }

            if (file instanceof TFile) {
                const adapter = app.vault.adapter;
                setTimeout(() => replace(vault.adapter as FileSystemAdapter, file, true), 100);
            }
        }));

        async function replace(root: FileSystemAdapter, file: TFile, notice: boolean) {
            const metadata = metadataCache.getFileCache(file);
            const links = [...(metadata?.links ?? []), ...(metadata?.embeds ?? [])];
            const replacePairs = links.map(({ link, original }) => {
                //if (!original.startsWith('![')) return null;

                const linkPath = link.replace(/#.*$/, '');
                if (!linkPath) {
                    return null;
                }

                const linkFile = metadataCache.getFirstLinkpathDest(linkPath, file.path);
                if (!linkFile) {
                    return null;
                }

                const newLinkPath = file.parent?.path === '/' ? linkFile.path : relative(file.path, linkFile.path);
                if (linkPath === newLinkPath) {
                    var bCheck = false;

                    const titleIndices = findBracketIndicesOfTitle(original)
                    if(titleIndices && 2 < (titleIndices.closeIndex - titleIndices.openIndex))
                    {
                        const altText = original.substring(titleIndices.openIndex , titleIndices.closeIndex)
                        if(altText.includes('/')){
                            bCheck = true;
                            console.log('1');
                        }
                        else if(!altText.includes('|650')){
                            bCheck = true;
                            console.log('2');
                        }
                    }

                    const linkIndices = findParenthesisIndicesOfURL(original)
                    if(linkIndices)
                    {
                        const url = original.substring(linkIndices.openIndex , linkIndices.closeIndex)
                        if(url.includes('..')){
                            bCheck = true;
                            console.log('3');
                        }
                        else if(bCheck && url.includes('.md')){
                            if(url.includes(`%`))
                            {
                                const checkUrl = url.replace(`%20`, `_`);
                                if(!checkUrl.includes(`%`))
                                {
                                    bCheck = false;
                                    console.log('-2');
                                }
                            }
                        }
                    }

                    if(!bCheck)
                    {
                        console.log('PASS: ' + file.name);
                        return null;
                    }
                }
                const newOriginal = replaceOriginal(root.getBasePath() + "/" + file.path, original, linkPath, newLinkPath);
                //new Notice(file.name + '\n- original: ' + original + '\n- newOriginal: ' + newOriginal);
                if (original === newOriginal) {
                    return null;
                }
                return [original, newOriginal];
            }).filter(pair => pair);

            if (!replacePairs?.length) {
                return 0;
            }

            try {
                const content = await vault.read(file);

                const replacedContent = replacePairs.reduce((tmpContent, pair) => {
                if (pair?.length === 2 && pair[0] !== null && pair[1] !== null) {
                    return tmpContent.replace(pair[0], pair[1]);
                }
                return tmpContent;
                }, content);

                await vault.modify(file, replacedContent);

                const msg = `Update ${replacePairs.length} links in ${file.path}.`;
                console.log(msg);
                if (notice) {
                    new Notice(msg);
                }
                return replacePairs.length;
            } catch (e) {
                console.error(e);
                if (notice) {
                    new Notice('Update links error, see console.');
                }
                throw e;
            }
        }

        function findBracketIndicesOfTitle(original: string): { openIndex: number; closeIndex: number } | null {
            const openIndex = original.indexOf('[')
            if (openIndex === -1) return null
            const closeIndex = original.indexOf('](', openIndex + 1)
            if (closeIndex === -1) return null
            return { openIndex, closeIndex }
        }

        function findParenthesisIndicesOfURL(str: string): { openIndex: number; closeIndex: number } | null {
            const openIndex = str.indexOf('(')
            if (openIndex === -1) return null
            const closeIndex = str.indexOf(')', openIndex + 1)
            if (closeIndex === -1) return null
            return { openIndex, closeIndex }
        }

        function getFileName(path: string): string {
            const segments = path.split('/');
            return decodeURIComponent(segments.pop() || '');
        }

        function getFullDirectory(path: string) {
            const parts = path.split('/');
            parts.pop();                // 마지막 요소(파일명) 제거
            return parts.join('/');     // 나머지 요소를 '/'로 결합
        }
        function getLastDirectory(path: string) {
            const parts = path.split('/');
            // 파일명이 아닌 마지막 폴더 인덱스는 length-2
            return parts.length >= 2 ? parts[parts.length - 2] : '';
        }
        function ensureDirSync(dirPath: string): void {
            //new Notice('ensureDirSync: ' + dirPath);
            
            const fs = require('fs');
            if (!fs.existsSync(dirPath)) {
                //new Notice('생성합니다.');
                fs.mkdirSync(dirPath, { recursive: true });
                //new Notice('생성 완료.');
                //if (fs.existsSync(dirPath)) {
                //    new Notice('존재합니다');
                //}
                //else{
                //    new Notice('생성 실패.');
                //}
            }
            //else{
            //    new Notice('존재합니다.');
            //}
        }

        async function copyFileAsync(src: string, dest: string) {
            try {
                await fs.access(src);  // 원본 파일 접근 확인
                try {
                    await fs.copyFile(src, dest);  // ✅ 올바른 복사 방식
                } catch (copyErr) {
                    new Notice('-2 복사 실패');
                    console.error(copyErr);
                }
        
            } catch (err) {
                new Notice('-1 원본 없음');
                console.error(err);
            }
        }

        function replaceOriginal(filePath: string, original: string, link: string, newLink: string) {
            console.log(`replaceOriginal:original: ${original}\n - Old: ${link}\n - New: ${newLink}`);

            const titleIndices = findBracketIndicesOfTitle(original)
            if(titleIndices && 2 < (titleIndices.closeIndex - titleIndices.openIndex))
            {
                const tmplinkIndices = findParenthesisIndicesOfURL(original)
                if(!tmplinkIndices)
                    return null;

                const url = original.substring(tmplinkIndices.openIndex + 1, tmplinkIndices.closeIndex)
                if(url.includes('.md')){
                    console.log(`File Link Research Start`);
                    const Title = original.substring(titleIndices.openIndex + 1 , titleIndices.closeIndex)
                    const newTitle = getFileName(Title)
                    original = original.replace(Title, newTitle);
                    console.log(`File Link Research Start\n - Old: ${Title}\n - New: ${newTitle}\n - Result: ${original}`);
                }
                else{
                    console.log(`Img Research Start`);
                    const Title = original.substring(0 , titleIndices.closeIndex)
                    if(Title.includes("![")){
                        const Title = original.substring(titleIndices.openIndex + 1 , titleIndices.closeIndex)
                        //new Notice('Title1: ' + Title);
                        original = original.replace(Title, `${getFileName(link)}|650`);
                        //new Notice('Title1 Result: ' + original);
                    }
                    else{
                        //new Notice('Title2: ' + Title);
                        original = original.replace(Title, getFileName(link));
                        //new Notice('Title2 Result: ' + original);
                    }
                }
            }
            else
            {
                console.log(`Empty Title`);
                //new Notice('Title3: ' + original);
                original = original.replace("[]", "["+link+"|650]");
                //new Notice('Title3 Result: ' + original);
            }

            const linkIndices = findParenthesisIndicesOfURL(original)
            if(linkIndices)
            {
                const url = original.substring(linkIndices.openIndex + 1, linkIndices.closeIndex)
                if(url.includes('..') && !url.includes('.md'))
                {
                    const fileDir = getFullDirectory(filePath);
                    //new Notice('fileDir: ' + fileDir);
                    const newUrlDir = fileDir + "/" + getLastDirectory(link);
                    //new Notice('newUrlDir: ' + newUrlDir);

                    ensureDirSync(newUrlDir)
                    copyFileAsync(fileDir+"/"+link, newUrlDir+"/"+getFileName(link))
                    newLink = getLastDirectory(link) + "/" + getFileName(link);
                    //new Notice('replaceOriginal');
                    //new Notice('fileDir: ' + fileDir);
                    //new Notice('filePath: ' + filePath);
                    //new Notice('original: ' + original);
                    //new Notice('link: ' + link);
                    //new Notice('newLink: ' + newLink);
                }

                let newOriginal = replaceWithFormat(original, "("+url+")", "("+newLink+")", s => s.replace(/ /g, '%20'));
                if (original === newOriginal) {
                    newOriginal = replaceWithFormat(original, "("+url+")", "("+newLink+")", encodeURI);
                    console.log(`1 newOriginal: ${newOriginal}`);
                }
                //if (original === newOriginal) {
                //    newOriginal = original.replace(/^(!?\[.*?\]).*$/, `$1(${encodeURI(newLink)})`)
                //    console.log(`2 newOriginal: ${newOriginal}`);
                //}
                console.log(`newOriginal: ${newOriginal}`);
                return newOriginal;
            }
            return null;
        }

        function replaceWithFormat(str: string, from: string, to: string, format: (s: string) => string) {
            return str.replace(format(from), format(to));
        }
    }
}
