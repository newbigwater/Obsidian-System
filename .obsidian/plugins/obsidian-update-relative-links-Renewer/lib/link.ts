// Markdown 링크 문자열을 다루는 순수 함수 모음. Obsidian API에 의존하지 않으므로 jest로 직접 시험한다.

export interface ParsedMarkdownLink {
    isEmbed: boolean;
    /** '[' 앞의 문자열('!' 제외) */
    prefix: string;
    altText: string;
    /** '(' 바로 뒤의 공백. 대상 앞 공백도 CommonMark에서 유효하다 */
    lead: string;
    /** 괄호 안의 링크 대상(제목 제외, '<>' 제외, '#subpath' 포함) */
    target: string;
    /** 대상이 '<...>' 형식이었는지 여부 */
    angle: boolean;
    /** 대상 뒤의 제목 부분(앞 공백 포함, 예: ' "title"'). 없으면 빈 문자열 */
    title: string;
    /** ')' 뒤의 문자열 */
    suffix: string;
}

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'avif'];

export function isImageExtension(extension: string): boolean {
    return IMAGE_EXTENSIONS.includes(extension.toLowerCase());
}

function findClosingParen(str: string, openIndex: number): number {
    let depth = 0;
    for (let i = openIndex + 1; i < str.length; i++) {
        const ch = str[i];
        if (ch === '\\') {
            i += 1;
            continue;
        }
        if (ch === '(') {
            depth += 1;
        } else if (ch === ')') {
            if (depth === 0) {
                return i;
            }
            depth -= 1;
        }
    }
    return -1;
}

export function parseMarkdownLink(original: string): ParsedMarkdownLink | null {
    const openBracket = original.indexOf('[');
    if (openBracket === -1) {
        return null;
    }
    const closeBracket = original.indexOf(']', openBracket);
    if (closeBracket === -1 || original[closeBracket + 1] !== '(') {
        return null;
    }
    const openParen = closeBracket + 1;
    const closeParen = findClosingParen(original, openParen);
    if (closeParen === -1) {
        return null;
    }

    let prefix = original.slice(0, openBracket);
    const isEmbed = prefix.endsWith('!');
    if (isEmbed) {
        prefix = prefix.slice(0, -1);
    }

    const rawInner = original.substring(openParen + 1, closeParen);
    const lead = rawInner.match(/^\s*/)?.[0] ?? '';
    const inner = rawInner.slice(lead.length);
    let target: string;
    let title: string;
    let angle = false;
    if (inner.startsWith('<')) {
        const closeAngle = inner.indexOf('>');
        if (closeAngle === -1) {
            return null;
        }
        angle = true;
        target = inner.substring(1, closeAngle);
        title = inner.slice(closeAngle + 1);
    } else {
        const space = inner.search(/\s/);
        target = space === -1 ? inner : inner.slice(0, space);
        title = space === -1 ? '' : inner.slice(space);
    }

    return {
        isEmbed,
        prefix,
        altText: original.substring(openBracket + 1, closeBracket),
        lead,
        target,
        angle,
        title,
        suffix: original.slice(closeParen + 1),
    };
}

export function formatMarkdownLink(link: ParsedMarkdownLink): string {
    const target = link.angle ? `<${link.target}>` : link.target;
    return `${link.prefix}${link.isEmbed ? '!' : ''}[${link.altText}](${link.lead}${target}${link.title})${link.suffix}`;
}

/** 'a/b.md#Heading' → { path: 'a/b.md', subpath: '#Heading' }. 인코딩된 '%23'은 경로의 일부로 본다. */
export function splitSubpath(target: string): { path: string; subpath: string } {
    const idx = target.indexOf('#');
    if (idx === -1) {
        return { path: target, subpath: '' };
    }
    return { path: target.slice(0, idx), subpath: target.slice(idx) };
}

/** decodeURIComponent가 실패하면(예: '100%.md') 원문을 돌려준다. */
export function safeDecode(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

/** Markdown 백슬래시 이스케이프를 푼다('a\\(1\\).md' → 'a(1).md'). */
export function unescapeMarkdown(text: string): string {
    return text.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

/**
 * 본문에 파일 이름이 나오는지 본다. 대소문자를 무시하고, Markdown 이스케이프('a\(1\).png')와
 * 퍼센트 인코딩('a%20b.png')을 푼 표기도 함께 비교한다. 결과가 애매하면 '나온다' 쪽으로 기운다.
 */
export function mentionsFileName(text: string, name: string): boolean {
    const decodeRuns = (t: string) => t.replace(/(?:%[0-9A-Fa-f]{2})+/g, run => safeDecode(run));
    const transforms = [unescapeMarkdown, decodeRuns, decodeHtmlEntities];
    // 표기를 푸는 순서가 섞여도 찾도록, 새 표기가 더 나오지 않을 때까지 모든 조합을 만든다(최대 6단계).
    let variants = new Set([text]);
    for (let round = 0; round < 6; round++) {
        const next = new Set(variants);
        variants.forEach(v => transforms.forEach(t => next.add(t(v))));
        if (next.size === variants.size) {
            break;
        }
        variants = next;
    }
    const target = name.toLowerCase();
    return [...variants].some(variant => variant.toLowerCase().includes(target));
}

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', lpar: '(', rpar: ')', lsqb: '[', rsqb: ']',
    lbrack: '[', rbrack: ']', num: '#', percnt: '%', excl: '!', quest: '?', period: '.', comma: ',', colon: ':',
    semi: ';', sol: '/', bsol: '\\', lowbar: '_', hyphen: '-', dash: '-', plus: '+', equals: '=', commat: '@',
    dollar: '$', ast: '*', midast: '*', tilde: '~', grave: '`', Hat: '^', vert: '|', verbar: '|', lcub: '{', rcub: '}',
};

/**
 * HTML 문자 참조('&#40;', '&#x28;', '&eacute;')를 푼다.
 * 브라우저(Obsidian)에서는 textarea로 모든 이름 참조를 풀고, DOM이 없으면(단위 시험) 숫자 참조와 자주 쓰는 이름만 푼다.
 */
export function decodeHtmlEntities(text: string): string {
    if (!text.includes('&')) {
        return text;
    }
    if (typeof document !== 'undefined') {
        // textarea 안은 태그를 해석하지 않고 문자 참조만 푼다.
        const area = document.createElement('textarea');
        area.innerHTML = text;
        return area.value;
    }
    return text.replace(/&(#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g, (whole, body: string) => {
        if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        return NAMED_ENTITIES[body] ?? whole;
    });
}

/** 링크 경로를 파일 조회에 쓸 후보로 바꾼다. 이스케이프를 풀고, 디코딩한 값과 원문을 모두 넣는다. */
export function linkLookupCandidates(path: string): string[] {
    const unescaped = unescapeMarkdown(path);
    return [...new Set([safeDecode(unescaped), unescaped])].filter(Boolean);
}

/**
 * 파일 경로를 Markdown 링크 대상으로 인코딩한다. 링크 문법을 깨는 '( ) # ?'도 인코딩한다.
 * '&'는 인코딩하지 않는다. Obsidian 1.15.0은 '%26'을 풀지 않아 'x%26y.png'가 깨진다('x&y.png'는 찾는다).
 */
export function encodeLinkPath(path: string): string {
    return encodeURI(path)
        .replace(/%5C/gi, '/')
        .replace(/[()#?]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * '<...>' 링크 대상용 인코딩. 공백은 읽기 쉽게 두고, 디코딩·앵커·괄호 문법을 깨는 '% # ? < >'만 인코딩한다.
 * '%'를 먼저 바꿔야 뒤에서 만든 '%23' 등이 다시 인코딩되지 않는다.
 */
export function encodeAngleLinkPath(path: string): string {
    return path
        .replace(/%/g, '%25')
        .replace(/[#?<>]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * 새 경로로 링크 대상을 만든다. 디코딩한 기존 경로와 새 경로가 같으면 기존 표기를 그대로 둔다.
 * subpath('#...')는 원문을 보존한다.
 */
export function buildLinkTarget(oldTarget: string, newPath: string, angle: boolean): string {
    const { path, subpath } = splitSubpath(oldTarget);
    if (linkLookupCandidates(path).includes(newPath)) {
        return oldTarget;
    }
    const encoded = angle ? encodeAngleLinkPath(newPath) : encodeLinkPath(newPath);
    // 비ASCII(한글 등)는 Obsidian 자체 링크처럼 인코딩하지 않는다.
    // 파일명에 '#'이 있으면 Obsidian 1.15.0이 어떤 표기로도 찾지 못하므로 그대로 둔다.
    if (!/[^\x00-\x7F]/.test(newPath) && !newPath.includes('#')) {
        return `${encoded}${subpath}`;
    }
    return `${newPath}${subpath}`;
}

/** 경로 세그먼트에 '..'이 있는지 확인한다('a..b.png' 같은 파일명은 제외). */
export function hasParentSegment(path: string): boolean {
    return path.split('/').includes('..');
}

/** 디코딩된 링크 경로의 마지막 폴더 이름. '..', '.', 없음이면 빈 문자열. 다시 디코딩하지 않는다. */
export function lastFolderName(path: string): string {
    const segments = path.split('/');
    segments.pop();
    const last = segments.pop() ?? '';
    return last === '..' || last === '.' ? '' : last;
}

export function stripWidthSuffix(text: string, widthSuffix: string): string {
    const idx = text.lastIndexOf('|');
    if (idx === -1) {
        return text;
    }
    const suffix = text.slice(idx + 1).trim();
    if (!suffix || suffix === widthSuffix || /^\d+(x\d+)?$/i.test(suffix)) {
        return text.slice(0, idx);
    }
    return text;
}

export interface TextReplacement {
    start: number;
    end: number;
    original: string;
    updated: string;
}

/**
 * 위치(offset) 기준으로 치환한다. 해당 위치의 문자열이 original과 다르면(캐시가 오래됨) 건너뛴다.
 * 문자열 치환 패턴('$&' 등)을 해석하지 않는다.
 */
export function applyReplacements(content: string, replacements: TextReplacement[]): { content: string; applied: TextReplacement[]; skipped: TextReplacement[] } {
    const sorted = [...replacements].sort((a, b) => b.start - a.start);
    const applied: TextReplacement[] = [];
    const skipped: TextReplacement[] = [];
    let result = content;
    let lowerBound = Number.POSITIVE_INFINITY;
    for (const r of sorted) {
        if (r.end > lowerBound || result.slice(r.start, r.end) !== r.original) {
            skipped.push(r);
            continue;
        }
        result = result.slice(0, r.start) + r.updated + result.slice(r.end);
        lowerBound = r.start;
        applied.push(r);
    }
    return { content: result, applied: applied.reverse(), skipped };
}

/** 'a/b.png' → 'a/b 1.png', 'a/b 2.png' ... 중 exists가 false인 첫 경로. */
export function nextAvailablePath(path: string, exists: (candidate: string) => boolean): string {
    if (!exists(path)) {
        return path;
    }
    const slash = path.lastIndexOf('/');
    const dir = slash === -1 ? '' : path.slice(0, slash + 1);
    const name = path.slice(slash + 1);
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 1; ; i++) {
        const candidate = `${dir}${base} ${i}${ext}`;
        if (!exists(candidate)) {
            return candidate;
        }
    }
}

/** JSON 문서(Canvas 등)의 모든 문자열 값을 줄로 이어 돌려준다. 파싱할 수 없으면 빈 문자열을 돌려준다. */
export function jsonStringValues(text: string): string {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return '';
    }
    const out: string[] = [];
    const walk = (value: unknown) => {
        if (typeof value === 'string') {
            out.push(value);
        } else if (Array.isArray(value)) {
            value.forEach(walk);
        } else if (value && typeof value === 'object') {
            Object.values(value as Record<string, unknown>).forEach(walk);
        }
    };
    walk(data);
    return out.join('\n');
}
