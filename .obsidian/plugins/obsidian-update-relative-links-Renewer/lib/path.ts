const SEP = '/';

function dirname(path: string): string {
    return stackToPath(pathToStack(path).slice(0, -1));
}

function relative(from: string, to: string): string {
    if (!from) {
        return to;
    }

    const fromStack = pathToStack(from);
    const toStack = pathToStack(to);

    // 같은 파일이면 파일명만 돌려준다(findIndex가 -1이 되어 '../..//a.md' 같은 값이 나오는 문제 방지).
    if (from === to) {
        return toStack[toStack.length - 1];
    }

    const firstDiffIdx = fromStack.findIndex((value, idx) => value != toStack[idx]);

    const resultStack: string[] = [];

    for (let i = firstDiffIdx; i < fromStack.length - 1; i++) {
        resultStack.push('..');
    }

    for (let i = firstDiffIdx; i < toStack.length; i++) {
        resultStack.push(toStack[i]);
    }

    return stackToPath(resultStack);
}

function pathToStack(path: string): string[] {
    return path.split(SEP);
}

function stackToPath(stack: string[]): string {
    return stack.join(SEP);
}

export { dirname, relative }
