impor    it('한글은 인코딩하지 않고 #이 든 파일명은 그대로 둔다', () => {
        expect(buildLinkTarget('한.md', '한글.md', false)).toBe('한글.md');
        expect(buildLinkTarget('a#b.md', 'x#y.md', false)).toBe('x#y.md');
        expect(buildLinkTarget('한#b.md', '새.md', false)).toBe('새.md');
    });
t {
    jsonStringValues,
    applyReplacements,
    buildLinkTarget,
    encodeAngleLinkPath,
    encodeLinkPath,
    formatMarkdownLink,
    hasParentSegment,
    lastFolderName,
    linkLookupCandidates,
    decodeHtmlEntities,
    mentionsFileName,
    nextAvailablePath,
    parseMarkdownLink,
    safeDecode,
    splitSubpath,
    stripWidthSuffix,
} from './link';
import { relative } from './path';

describe('parseMarkdownLink', () => {
    it('일반 링크와 임베드를 구분한다', () => {
        expect(parseMarkdownLink('[a](b.md)')).toMatchObject({ isEmbed: false, altText: 'a', target: 'b.md', title: '' });
        expect(parseMarkdownLink('![a|650](img/b.png)')).toMatchObject({ isEmbed: true, altText: 'a|650', target: 'img/b.png' });
    });

    it('제목과 <> 대상을 분리한다', () => {
        expect(parseMarkdownLink('[a](b.md "t")')).toMatchObject({ target: 'b.md', title: ' "t"' });
        expect(parseMarkdownLink('[a](<b c.md> "t")')).toMatchObject({ target: 'b c.md', angle: true, title: ' "t"' });
    });

    it('( 뒤 공백을 대상과 분리하고 보존한다', () => {
        const p = parseMarkdownLink('[x]( ../ref.md)')!;
        expect(p).toMatchObject({ lead: ' ', target: '../ref.md' });
        expect(formatMarkdownLink(p)).toBe('[x]( ../ref.md)');
    });

    it('괄호가 든 경로를 끝까지 읽는다', () => {
        expect(parseMarkdownLink('[a](x(1).md)')).toMatchObject({ target: 'x(1).md' });
    });

    it('위키 링크는 null', () => {
        expect(parseMarkdownLink('[[note]]')).toBeNull();
    });

    it('format은 parse의 역이다', () => {
        for (const s of ['[a](b.md "t")', '![x|650](../i.png)', '[a](<b c.md>)']) {
            expect(formatMarkdownLink(parseMarkdownLink(s)!)).toBe(s);
        }
    });
});

describe('splitSubpath / safeDecode', () => {
    it('앵커를 분리하고 %23은 경로로 둔다', () => {
        expect(splitSubpath('a.md#H%20x')).toEqual({ path: 'a.md', subpath: '#H%20x' });
        expect(splitSubpath('a%23b.md')).toEqual({ path: 'a%23b.md', subpath: '' });
    });

    it('잘못된 % 표기에서 예외를 내지 않는다', () => {
        expect(safeDecode('100%.md')).toBe('100%.md');
        expect(safeDecode('a%20b.md')).toBe('a b.md');
    });
});

describe('encodeLinkPath / buildLinkTarget', () => {
    it('링크 문법을 깨는 문자를 인코딩한다', () => {
        expect(encodeLinkPath('a b/c(1).md')).toBe('a%20b/c%281%29.md');
        expect(encodeLinkPath('100%.md')).toBe('100%25.md');
        expect(encodeLinkPath('a%20b.md')).toBe('a%2520b.md');
    });

    it('경로가 같으면 기존 표기를 유지한다', () => {
        expect(buildLinkTarget('%ED%95%9C.md', '한.md', false)).toBe('%ED%95%9C.md');
        expect(buildLinkTarget('한.md', '한.md', false)).toBe('한.md');
    });

    it('경로가 바뀌어도 앵커를 보존한다', () => {
        expect(buildLinkTarget('../a.md#Head%20One', 'a.md', false)).toBe('a.md#Head%20One');
        expect(buildLinkTarget('x/a b.md#^blk', 'a b.md', true)).toBe('a b.md#^blk');
    });

    it('<> 대상도 % # ? < >를 인코딩하고 공백은 둔다 (R3)', () => {
        expect(encodeAngleLinkPath('assets/a#b.png')).toBe('assets/a%23b.png');
        expect(encodeAngleLinkPath('a%20b c.png')).toBe('a%2520b c.png');
        expect(encodeAngleLinkPath('q?<x>.md')).toBe('q%3F%3Cx%3E.md');
        expect(buildLinkTarget('../assets/a%23b.png', 'n/assets/a#b.png', true)).toBe('n/assets/a%23b.png');
        expect(buildLinkTarget('../x/a%2520b.png#^k', 'a%20b.png', true)).toBe('a%2520b.png#^k');
    });
});

describe('linkLookupCandidates', () => {
    it('이스케이프를 풀고 디코딩 값과 원문을 모두 돌려준다', () => {
        expect(linkLookupCandidates('../a\\(1\\).md')).toEqual(['../a(1).md']);
        expect(linkLookupCandidates('../a%20b.md')).toEqual(['../a b.md', '../a%20b.md']);
        expect(linkLookupCandidates('100%.md')).toEqual(['100%.md']);
    });

    it('<> 대상의 퍼센트 표기도 경로가 같으면 그대로 둔다', () => {
        expect(buildLinkTarget('../a%20b.md', '../a b.md', true)).toBe('../a%20b.md');
    });
});

describe('hasParentSegment / lastFolderName', () => {
    it('.. 세그먼트만 인정한다', () => {
        expect(hasParentSegment('../i.png')).toBe(true);
        expect(hasParentSegment('a..b.png')).toBe(false);
    });

    it('마지막 폴더가 .. 이면 빈 문자열', () => {
        expect(lastFolderName('../img.png')).toBe('');
        expect(lastFolderName('../00. attachments/a.png')).toBe('00. attachments');
        // 이미 디코딩된 값을 다시 디코딩하지 않는다
        expect(lastFolderName('../img%20dir/a.png')).toBe('img%20dir');
        expect(lastFolderName('a.png')).toBe('');
    });
});

describe('stripWidthSuffix', () => {
    it('폭 접미사만 제거한다', () => {
        expect(stripWidthSuffix('a|650', '650')).toBe('a');
        expect(stripWidthSuffix('a|100x200', '650')).toBe('a');
        expect(stripWidthSuffix('a|caption', '650')).toBe('a|caption');
    });
});

describe('applyReplacements', () => {
    it('위치 기준으로 치환하고 $ 패턴을 해석하지 않는다', () => {
        const content = '`[go](x.md)` and [go](x.md)';
        const start = content.lastIndexOf('[go]');
        const r = applyReplacements(content, [{ start, end: start + 11, original: '[go](x.md)', updated: '[go]($&.md)' }]);
        expect(r.content).toBe('`[go](x.md)` and [go]($&.md)');
    });

    it('위치의 문자열이 다르면 건너뛴다', () => {
        const r = applyReplacements('abc', [{ start: 0, end: 1, original: 'z', updated: 'y' }]);
        expect(r.content).toBe('abc');
        expect(r.skipped).toHaveLength(1);
    });

    it('여러 치환을 뒤에서부터 적용한다', () => {
        const r = applyReplacements('A B', [
            { start: 0, end: 1, original: 'A', updated: 'AAA' },
            { start: 2, end: 3, original: 'B', updated: 'BB' },
        ]);
        expect(r.content).toBe('AAA BB');
        expect(r.applied).toHaveLength(2);
    });
});

describe('nextAvailablePath', () => {
    it('존재하지 않는 이름을 찾는다', () => {
        const taken = new Set(['d/a.png', 'd/a 1.png']);
        expect(nextAvailablePath('d/a.png', p => taken.has(p))).toBe('d/a 2.png');
        expect(nextAvailablePath('d/b.png', p => taken.has(p))).toBe('d/b.png');
    });
});

describe('relative (같은 파일)', () => {
    it('자기 자신이면 파일명만 돌려준다', () => {
        expect(relative('a/note.md', 'a/note.md')).toBe('note.md');
        expect(relative('note.md', 'note.md')).toBe('note.md');
    });
});

describe('mentionsFileName', () => {
    it('finds raw, escaped, percent-encoded and case-changed names', () => {
        expect(mentionsFileName('![](shared/a\\(1\\).png)', 'a(1).png')).toBe(true);
        expect(mentionsFileName('![](shared/a%20b.png)', 'a b.png')).toBe(true);
        expect(mentionsFileName('![](<shared/a%28b.png>)', 'a(b.png')).toBe(true);
        expect(mentionsFileName('![[A B.PNG]]', 'a b.png')).toBe(true);
        expect(mentionsFileName('{"text":"see %EC%95%88.png"}', '안.png')).toBe(true);
        expect(mentionsFileName('![](a%2520b.png)', 'a%20b.png')).toBe(true);
        expect(mentionsFileName('![](shared/a&#40;1&#41;.png)', 'a(1).png')).toBe(true);
        expect(mentionsFileName('![](shared/a&#x28;1&rpar;.png)', 'a(1).png')).toBe(true);
        expect(mentionsFileName('![](a&amp;b%20c.png)', 'a&b c.png')).toBe(true);
        expect(mentionsFileName('![](shared/a\\(1&#41;%20b.png)', 'a(1) b.png')).toBe(true);
    });

    it('does not throw on broken percent sequences and reports absence', () => {
        expect(mentionsFileName('100% done %E0%A4 ![](x.png)', 'y.png')).toBe(false);
        expect(mentionsFileName('![](other.png)', 'a b.png')).toBe(false);
    });
});

describe('decodeHtmlEntities', () => {
    it('decodes numeric and known named references only', () => {
        expect(decodeHtmlEntities('a&#40;1&#x29;&lpar;&amp;&unknown;&#0;')).toBe('a(1)(&&unknown;&#0;');
    });
});

describe('ampersand encoding', () => {
    it('keeps & because Obsidian does not decode %26', () => {
        expect(encodeLinkPath('shared/x&y.png')).toBe('shared/x&y.png');
        expect(encodeAngleLinkPath('shared/x&y.png')).toBe('shared/x&y.png');
    });
});

describe('jsonStringValues', () => {
    it('decodes JSON unicode escapes in canvas', () => {
        const canvas = '{"nodes":[{"type":"file","file":"shared/\\u0061.png"}]}';
        expect(mentionsFileName(canvas, 'a.png')).toBe(false);
        expect(mentionsFileName(jsonStringValues(canvas), 'a.png')).toBe(true);
    });
    it('returns empty string for invalid JSON', () => {
        expect(jsonStringValues('{bad')).toBe('');
    });
});
