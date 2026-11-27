// Faster drop-in for makefun-diff 1.0.0 (make.fun's own line diff).
//
// Implements exactly the rule in the competition's RULES.txt / the reference header:
// lines cut after every "\n"; common prefix, then common suffix, trimmed first; between
// them Myers's greedy search which on each diagonal keeps the path furthest into the old
// text, deletion winning ties, never moving past either text's end, pruning no edge
// diagonal, following every run of equal lines as far as it goes; first path to reach both
// ends is the script; patch with 3 lines of context, hunks merged when at most 6 kept
// lines apart, deletions before insertions in each change run, "%" after a line with no
// trailing newline. Identical texts are the header line alone.
//
// Speed comes from doing the same search on interned line ids (integer equality) with
// the furthest-x values held in small per-distance padded Int32Array slices — one slice
// per edit distance d, kept for backtracking — instead of one heap object per path per
// diagonal. No dependency, no I/O, no state kept between calls.

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** The patch's first word. */
const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

/**
 * Split a text into lines (each with its "\n", the last one without when the text does
 * not end in one) and intern each distinct line to an integer id in `ids` (shared by
 * both texts, so equal lines get equal ids). Appends the line strings to `lines` and
 * the ids to `out`.
 */
function tokenize(text, ids, lines, out) {
  // Slice each line (newline included) straight out of the text: no split array,
  // no per-line string concatenation.
  let start = 0;
  for (;;) {
    const idx = text.indexOf('\n', start);
    if (idx === -1) break;
    const line = text.slice(start, idx + 1);
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    lines.push(line);
    out.push(id);
    start = idx + 1;
  }
  if (start < text.length) {
    const line = text.slice(start);
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    lines.push(line);
    out.push(id);
  }
}

/**
 * Myers's greedy search on the interned middle slices A (length N) and B (length M).
 *
 * History: hist[d] is a padded Int32Array of length d+3 holding V_d: hist[d][0] is -1,
 * hist[d][j+1] is V_d[k] for k = -d+2j (the furthest old-lines-consumed count reached on
 * diagonal k with d edits, after its snake; -1 when that diagonal holds no path at d),
 * hist[d][d+2] is -1. The padding makes the two predecessors of (d, k) sit at Vp[j] and
 * Vp[j+1] with j = (k+d)/2, no edge tests in the loop.
 *
 * The search follows the reference exactly: k from -d to d in steps of 2, deletion
 * candidate V[k-1]+1 when that path exists and has not consumed all old lines, insertion
 * candidate V[k+1] when that path exists and its new line exists, the further into the
 * old text wins, deletion on a tie; the first (d, k) in that order whose snake reaches
 * both ends ends the search.
 */
function myers(A, B, N, M) {
  const hist = [];
  // d = 0: the snake from (0, 0).
  let x = 0;
  while (x < N && x < M && A[x] === B[x]) x++;
  const v0 = new Int32Array(3);
  v0[0] = -1;
  v0[1] = x;
  v0[2] = -1;
  hist.push(v0);
  if (x >= N && x >= M) return { D: 0, hist };
  for (let d = 1; d <= N + M; d++) {
    const Vp = hist[d - 1];
    const Vc = new Int32Array(d + 3);
    Vc[0] = -1;
    Vc[d + 2] = -1;
    for (let j = 0, k = -d; j <= d; j++, k += 2) {
      const rm = Vp[j];
      const ad = Vp[j + 1];
      const canR = rm >= 0 && rm < N;
      const canA = ad >= 0 && ad - k <= M;
      if (!canR && !canA) {
        Vc[j + 1] = -1;
        continue;
      }
      const byD = canR ? rm + 1 : -2;
      const byI = canA ? ad : -2;
      let xx = byD >= byI ? byD : byI;
      let y = xx - k;
      while (xx < N && y < M && A[xx] === B[y]) {
        xx++;
        y++;
      }
      Vc[j + 1] = xx;
      if (xx >= N && y >= M) {
        hist.push(Vc);
        return { D: d, hist };
      }
    }
    hist.push(Vc);
  }
  throw new Error('makefun-diff: the search ended without reaching both ends');
}

/**
 * The edit script's runs [{ kind, count }] for the middle slices, recovered from the
 * search history by walking back from (D, N-M) and re-applying the forward tie-break
 * at every step, so the path is the same one the forward search found first.
 */
function backtrackRuns(N, M, D, hist) {
  const rev = [];
  let d = D;
  let k = N - M;
  let x = N;
  while (d > 0) {
    const Vp = hist[d - 1];
    const j = (k + d) >> 1;
    const xe = hist[d][j + 1];
    const rm = Vp[j];
    const ad = Vp[j + 1];
    const canR = rm >= 0 && rm < N;
    const canA = ad >= 0 && ad - k <= M;
    if (!canR && !canA) throw new Error('makefun-diff: backtrack reached a diagonal with no path');
    const byD = canR ? rm + 1 : -2;
    const byI = canA ? ad : -2;
    const isDel = byD >= byI;
    const xs = isDel ? rm + 1 : ad;
    // The snake from the pre-edit point (xs, xs-k) to the endpoint (xe, xe-k): kept lines.
    for (let t = xe - xs; t > 0; t--) rev.push(KEEP);
    if (isDel) {
      rev.push(DELETE);
      x = xs - 1;
      k = k - 1;
    } else {
      rev.push(INSERT);
      x = xs;
      k = k + 1;
    }
    d--;
  }
  // d = 0: the opening snake from (0, 0) to (x, x).
  for (let t = x; t > 0; t--) rev.push(KEEP);
  // Reverse the collected ops into runs, grouping equal neighbours.
  const runs = [];
  for (let i = rev.length - 1; i >= 0;) {
    const kind = rev[i];
    let j = i;
    while (j >= 0 && rev[j] === kind) j--;
    runs.push({ kind, count: i - j });
    i = j;
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/** make.fun's own patch of input.old into input.new, as one string. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const ids = new Map();
  const aLines = [];
  const bLines = [];
  const aIds = [];
  const bIds = [];
  tokenize(input.old, ids, aLines, aIds);
  tokenize(input.new, ids, bLines, bIds);
  const a = aIds;
  const b = bIds;
  const n = a.length;
  const m = b.length;

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;

  const N = n - prefix - suffix;
  const M = m - prefix - suffix;
  const { D, hist } = myers(a.slice(prefix, n - suffix), b.slice(prefix, m - suffix), N, M);
  const midRuns = backtrackRuns(N, M, D, hist);

  // The runs for the whole texts: prefix kept, the middle script, suffix kept.
  const runs = [];
  const pushRun = (kind, count) => {
    if (count <= 0) return;
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === kind) last.count += count;
    else runs.push({ kind, count });
  };
  pushRun(KEEP, prefix);
  for (const r of midRuns) pushRun(r.kind, r.count);
  pushRun(KEEP, suffix);

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', aLines[at]));
      for (let i = 0; i < c.dels; i++) out.push(written('-', aLines[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written('+', bLines[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', aLines[at]));
  }
  return out.join('');
}
