import type { HealthRecord, ToolClass } from './types.js';
/** Collapse whitespace outside quotes without interpreting shell syntax. */
export function normalizeCommand(value: string): string {
    let out = '', quote = '', space = false;
    for (let i = 0; i < value.length; i++) {
        const c = value[i]!;
        if (c === '\\' && quote !== "'") {
            if (space && out)
                out += ' ';
            space = false;
            out += c + (value[++i] ?? '');
            continue;
        }
        if (quote) {
            out += c;
            if (c === quote)
                quote = '';
            continue;
        }
        if (c === '"' || c === "'") {
            if (space && out)
                out += ' ';
            space = false;
            quote = c;
            out += c;
        }
        else if (/\s/.test(c))
            space = true;
        else {
            if (space && out)
                out += ' ';
            space = false;
            out += c;
        }
    }
    return out;
}
export function normalizePath(value: string): string {
    if (/^[a-z]+:\/\//i.test(value))
        return value;
    const path = value.replaceAll('\\', '/'), prefix = path.startsWith('/') ? '/' : '';
    const parts: string[] = [];
    for (const part of path.split('/')) {
        if (!part || part === '.')
            continue;
        if (part === '..' && parts.length && parts.at(-1) !== '..')
            parts.pop();
        else if (part !== '..' || !prefix)
            parts.push(part);
    }
    return prefix + parts.join('/') || '.';
}
export function commandProjection(command: string | null, cwd: string | null): {
    command: string | null;
    cwd: string | null;
    cd: boolean;
    fingerprint: string | null;
} {
    if (command === null)
        return { command: null, cwd, cd: false, fingerprint: null };
    let cmd = normalizeCommand(command);
    const m = /^cd\s+("[^"\n]+"|'[^'\n]+'|[^;&|\s]+)\s*&&\s*(.+)$/.exec(cmd);
    let dir = cwd;
    if (m) {
        const target = m[1]!.replace(/^(['"])(.*)\1$/, '$2');
        dir = /[$`]/.test(target) ? null : target.startsWith('/') || /^[a-z]:[\\/]/i.test(target) ? normalizePath(target) : cwd === null ? null : normalizePath(cwd + '/' + target);
        cmd = m[2]!;
    }
    dir = dir === null ? null : normalizePath(dir);
    return { command: cmd, cwd: dir, cd: Boolean(m), fingerprint: dir && cmd ? JSON.stringify([dir, cmd]) : null };
}
export function classifyTool(record: HealthRecord): ToolClass {
    if (record.native.delegateMemberId)
        return 'delegate';
    const name = (record.event?.tool ?? record.event?.kind ?? '').toLowerCase();
    const command = commandProjection(record.native.command, null).command ?? '';
    const commands = command.split(/(?:&&|\|\||;|\|)/).map(x => x.trim().replace(/^(?:[^\s]+\/)/, '').replace(/^npx\s+/, ''));
    const matches = (pattern: RegExp) => commands.some(cmd => pattern.test(cmd));
    if (matches(/^(?:(?:npm|pnpm|yarn)\s+(?:install|ci)(?:\s|$)|pip\d?\s+install\b|mvn\s+dependency:|gradle\b.*--refresh)/))
        return 'install';
    if (matches(/^(?:(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:lint|typecheck)\b|(?:tsc|eslint)\b)/) || /lint|typecheck/.test(name))
        return 'lint/typecheck';
    if (matches(/^(?:(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b|(?:vitest|jest|pytest)\b)/) || name === 'test')
        return 'test';
    if (matches(/^(?:(?:npm|pnpm|yarn)\s+(?:run\s+)?build\b|(?:make|build|compile)\b)/))
        return 'build';
    if (/write|edit|patch/.test(name))
        return 'write/edit';
    if (/read|view_file|cat_file/.test(name) || /^\s*(?:cat|head|tail)\b/.test(command))
        return 'read';
    if (/search|grep|glob|find/.test(name) || /^(?:rg|grep|find|ls)\b/.test(command))
        return 'search';
    if (/web|fetch|browse/.test(name) || /^(?:curl|wget)\b/.test(command))
        return 'web';
    if (/shell|bash|exec|terminal/.test(name) || record.native.command !== null)
        return 'shell';
    return 'other';
}
