/**
 * Returns for each char of the query whether it is part of a
 * quoted string literal like 'foo\'s file'.
 * Inside of literals, \' and \\ are escape sequences.
 * Parens and the and/or keywords must only be handled
 * outside of literals.
 */
export function getInsideLiteral(str: string): boolean[] {
    const ret: boolean[] = new Array(str.length).fill(false);
    let inLiteral = false;
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (inLiteral) {
            ret[i] = true;
            if (char === '\\') {
                if (i + 1 < str.length) {
                    ret[i + 1] = true;
                }
                i++;
            } else if (char === "'") {
                inLiteral = false;
            }
        } else if (char === "'") {
            ret[i] = true;
            inLiteral = true;
        }
    }
    return ret;
}

export function unescapeLiteral(value: string | undefined): string | undefined {
    return value === undefined ? value : value.replace(/\\(.)/g, '$1');
}

/**
 * Splits the query by the given separator,
 * but only where the separator is outside of string literals.
 */
export function splitOutsideLiterals(str: string, separator: string): string[] {
    const insideLiteral = getInsideLiteral(str);
    const lower = str.toLowerCase();
    const ret: string[] = [];
    let start = 0;
    for (let i = 0; i < str.length; i++) {
        if (!insideLiteral[i] && lower.startsWith(separator, i)) {
            ret.push(str.substring(start, i));
            i += separator.length - 1;
            start = i + 1;
        }
    }
    ret.push(str.substring(start));
    return ret;
}
