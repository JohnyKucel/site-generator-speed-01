// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01).
// A from-scratch reimplementation of build() that returns byte-identical
// output: same front matter, template dialect, Markdown subset, slug rule
// and report. Speed comes from bulk HTML escaping, fused lex+render
// Markdown without per-line regexes, cached slugify/longDate, and
// templates compiled once per build into flat op arrays rendered by a
// tight loop. No imports, no state kept between run() calls.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_TEST = /[&<>"']/;
const ESC_RE = /[&<>"']/g;
// Escape &, <, >, " and '. Returns the input unchanged when it holds none.
function escapeHtml(t) {
  return ESC_TEST.test(t) ? t.replace(ESC_RE, (c) => ESC[c]) : t;
}

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- slug

function slugifyRaw(text) {
  let out = '';
  let gap = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 127) return slugifyUnicode(text);
    let keep = 0;
    if (c >= 65 && c <= 90) keep = c + 32;
    else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
    if (keep === 0) {
      if (out.length > 0) gap = true;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += String.fromCharCode(keep);
  }
  out = out.slice(0, 64);
  let e = out.length;
  while (e > 0 && out.charCodeAt(e - 1) === 45) e--;
  out = out.slice(0, e);
  return out === '' ? 'untitled' : out;
}

function slugifyUnicode(text) {
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (let i = 0; i < plain.length; i++) {
    const c = plain.charCodeAt(i);
    let keep = 0;
    if (c >= 65 && c <= 90) keep = c + 32;
    else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
    if (keep === 0) {
      if (out.length > 0) gap = true;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += String.fromCharCode(keep);
  }
  out = out.slice(0, 64);
  let e = out.length;
  while (e > 0 && out.charCodeAt(e - 1) === 45) e--;
  out = out.slice(0, e);
  return out === '' ? 'untitled' : out;
}

function slugify(G, text) {
  const c = G.slugCache.get(text);
  if (c !== undefined) return c;
  const s = slugifyRaw(text);
  G.slugCache.set(text, s);
  return s;
}

function uniqueSlug(G, slug, dir) {
  let rec = G.taken.get(dir);
  if (rec === undefined) {
    rec = { set: new Set(dir === '' ? ['posts', 'tags', 'page'] : []), next: new Map() };
    G.taken.set(dir, rec);
  }
  if (!rec.set.has(slug)) {
    rec.set.add(slug);
    return slug;
  }
  let n = rec.next.get(slug) || 2;
  let out = slug + '-' + n;
  while (rec.set.has(out)) {
    n++;
    out = slug + '-' + n;
  }
  rec.set.add(out);
  rec.next.set(slug, n + 1);
  return out;
}

function longDate(G, date) {
  let s = G.dateCache.get(date);
  if (s !== undefined) return s;
  s = Number(date.slice(8, 10)) + ' ' + MONTHS[Number(date.slice(5, 7)) - 1] + ' ' + date.slice(0, 4);
  G.dateCache.set(date, s);
  return s;
}

// ---------------------------------------------------------------- front matter

const FM_KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function isDigit(c) {
  return c >= 48 && c <= 57;
}

// A string value: "..." with \" and \\ its only escapes, or bare.
function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function isLayoutName(raw) {
  if (raw.length === 0) return false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) return false;
  }
  return true;
}

function isSlugValue(raw) {
  const n = raw.length;
  if (n === 0 || n > 64) return false;
  let i = 0;
  while (i < n) {
    let c = raw.charCodeAt(i);
    if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57))) return false;
    i++;
    while (i < n) {
      c = raw.charCodeAt(i);
      if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) i++;
      else break;
    }
    if (i < n) {
      if (raw.charCodeAt(i) !== 45) return false;
      i++;
      if (i >= n) return false;
    }
  }
  return true;
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: 'key "' + key + '": ' + s.error } : s;
    }
    case 'date': {
      let ok = raw.length === 10 && raw.charCodeAt(4) === 45 && raw.charCodeAt(7) === 45;
      if (ok) {
        for (let i = 0; i < 10; i++) {
          if (i === 4 || i === 7) continue;
          if (!isDigit(raw.charCodeAt(i))) { ok = false; break; }
        }
      }
      const y = ok ? Number(raw.slice(0, 4)) : 0;
      const mo = ok ? Number(raw.slice(5, 7)) : 0;
      const d = ok ? Number(raw.slice(8, 10)) : 0;
      if (!ok || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) {
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      }
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',');
      for (let k = 0; k < tags.length; k++) {
        const t = tags[k].trim();
        tags[k] = t;
        if (t === '') return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        for (let j = 0; j < t.length; j++) {
          const c = t.charCodeAt(j);
          if (c === 34 || c === 91 || c === 93) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        }
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return isLayoutName(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return isSlugValue(raw) ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: 'unknown key "' + key + '"' };
  }
}

function isBlankLine(text, a, b) {
  for (let i = a; i < b; i++) {
    const c = text.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function parseFrontMatter(text) {
  const total = text.length;
  let nl = text.indexOf('\n');
  const firstEnd = nl === -1 ? total : nl;
  if (firstEnd !== 3 || text.charCodeAt(0) !== 45 || text.charCodeAt(1) !== 45 || text.charCodeAt(2) !== 45) {
    return { error: 'no front matter' };
  }
  // Find the closing '---' line.
  let pos = firstEnd + 1;
  let lineNo = 2;
  let closeLine = -1;
  let closeEnd = -1;
  while (pos <= total) {
    const e = text.indexOf('\n', pos);
    const lineEnd = e === -1 ? total : e;
    if (lineEnd - pos === 3 && text.charCodeAt(pos) === 45 && text.charCodeAt(pos + 1) === 45 && text.charCodeAt(pos + 2) === 45) {
      closeLine = lineNo;
      closeEnd = e === -1 ? total : e + 1;
      break;
    }
    if (e === -1) break;
    pos = lineEnd + 1;
    lineNo++;
  }
  if (closeLine === -1) return { error: 'the front matter is not closed' };
  const data = {};
  pos = firstEnd + 1;
  lineNo = 2;
  while (lineNo < closeLine) {
    const e = text.indexOf('\n', pos);
    const lineEnd = e === -1 ? total : e;
    if (!isBlankLine(text, pos, lineEnd) && text.charCodeAt(pos) !== 35) {
      // Parse "key: value": key of [a-z_]+, ':', then optionally ' ' + rest.
      let k = pos;
      while (k < lineEnd) {
        const c = text.charCodeAt(k);
        if ((c >= 97 && c <= 122) || c === 95) k++;
        else break;
      }
      if (k === pos || k >= lineEnd || text.charCodeAt(k) !== 58) {
        return { error: 'line ' + lineNo + ' is not "key: value"' };
      }
      const key = text.slice(pos, k);
      let raw;
      if (k + 1 === lineEnd) raw = '';
      else if (text.charCodeAt(k + 1) === 32) raw = text.slice(k + 2, lineEnd);
      else return { error: 'line ' + lineNo + ' is not "key: value"' };
      let r = raw.length;
      while (r > 0) {
        const c = raw.charCodeAt(r - 1);
        if (c === 32 || c === 9) r--;
        else break;
      }
      raw = raw.slice(0, r);
      if (FM_KEYS.indexOf(key) === -1) return { error: 'unknown key "' + key + '"' };
      if (Object.hasOwn(data, key)) return { error: 'key "' + key + '" is given twice' };
      if (raw === '') return { error: 'key "' + key + '" has no value' };
      const v = valueOf(key, raw);
      if ('error' in v) return v;
      data[key] = v.value;
    }
    if (e === -1) break;
    pos = lineEnd + 1;
    lineNo++;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: text.slice(closeEnd) };
}

// ---------------------------------------------------------------- markdown

function isEscapableCode(c) {
  return c === 92 || c === 96 || c === 42 || c === 95 || c === 91 || c === 93 || c === 40 || c === 41 || c === 35 || c === 43 || c === 45 || c === 46 || c === 33 || c === 62;
}

function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b) {
    const c = line.charCodeAt(a);
    if (c === 32 || c === 9) a++;
    else break;
  }
  while (b > a) {
    const c = line.charCodeAt(b - 1);
    if (c === 32 || c === 9) b--;
    else break;
  }
  return line.slice(a, b);
}

function isBlankStr(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function fenceLang(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let j = 3;
  const L = line.length;
  while (j < L) {
    const c = line.charCodeAt(j);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) j++;
    else break;
  }
  const lang = line.slice(3, j);
  while (j < L) {
    const c = line.charCodeAt(j);
    if (c === 32 || c === 9) j++;
    else return null;
  }
  return lang;
}

function isFenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let j = 3; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function headingOf(line) {
  let h = 0;
  while (h < line.length && line.charCodeAt(h) === 35) h++;
  if (h === 0 || h > 6) return null;
  if (h >= line.length) return null;
  let c = line.charCodeAt(h);
  if (c !== 32 && c !== 9) return null;
  let s = h;
  while (s < line.length) {
    c = line.charCodeAt(s);
    if (c === 32 || c === 9) s++;
    else break;
  }
  let e = line.length;
  while (e > s) {
    c = line.charCodeAt(e - 1);
    if (c === 32 || c === 9) e--;
    else break;
  }
  if (e === s) return null;
  return { depth: h, text: line.slice(s, e) };
}

function isHR(line) {
  const c0 = line.charCodeAt(0);
  if (c0 !== 45 && c0 !== 42) return false;
  if (line.charCodeAt(1) !== c0 || line.charCodeAt(2) !== c0) return false;
  for (let j = 3; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function endsParagraph(line) {
  return isBlankStr(line) || fenceLang(line) !== null || headingOf(line) !== null || isHR(line);
}

// Returns {ordered, start, text} for a list-item line, else null.
function listStart(line) {
  const c0 = line.charCodeAt(0);
  if ((c0 === 45 || c0 === 42) && line.charCodeAt(1) === 32) return { ordered: false, start: 1, text: line.slice(2) };
  let j = 0;
  while (j < line.length && j < 9) {
    const c = line.charCodeAt(j);
    if (c >= 48 && c <= 57) j++;
    else break;
  }
  if (j >= 1 && line.charCodeAt(j) === 46 && line.charCodeAt(j + 1) === 32) {
    return { ordered: true, start: Number(line.slice(0, j)), text: line.slice(j + 2) };
  }
  return null;
}

function isContinued(line) {
  let sp = 0;
  while (sp < line.length && line.charCodeAt(sp) === 32) sp++;
  if (sp < 2) return false;
  if (sp >= line.length) return false;
  return !/\s/.test(line[sp]);
}

function findUnescaped(s, what, from, end) {
  const wl = what.length;
  for (let j = from; j + wl <= end; j++) {
    if (s.charCodeAt(j) === 92 && j + 1 < end && isEscapableCode(s.charCodeAt(j + 1))) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

function findSingleStar(s, from, end) {
  for (let j = from; j < end; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < end && isEscapableCode(s.charCodeAt(j + 1))) {
      j++;
      continue;
    }
    if (c !== 42) continue;
    if (j + 1 < end && s.charCodeAt(j + 1) === 42) {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

// Inline-render s[a..b) into out (array of strings). link(target) resolves a link href.
// One native regex scan finds the next inline special or escapable
// character; plain runs between them hold neither, so they are pushed raw
// with no escape call at all. The regex's lastIndex is reset at the top of
// every loop turn, so recursive calls cannot disturb the outer scan.
const INLINE_SPECIAL = /[\\`*\[&<>"']/g;
function inlineRange(s, a, b, link, out) {
  let i = a;
  while (i < b) {
    INLINE_SPECIAL.lastIndex = i;
    const m = INLINE_SPECIAL.exec(s);
    if (m === null || m.index >= b) break;
    const j = m.index;
    if (j > i) out.push(s.slice(i, j));
    i = j;
    const c = s.charCodeAt(i);
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) {
      out.push(ESC[s[i]]);
      i++;
      continue;
    }
    if (c === 92) {
      if (i + 1 < b && isEscapableCode(s.charCodeAt(i + 1))) {
        const n = s.charCodeAt(i + 1);
        out.push(n === 62 ? '&gt;' : s[i + 1]);
        i += 2;
      } else {
        out.push('\\');
        i++;
      }
      continue;
    }
    if (c === 96) {
      let k = s.indexOf('`', i + 1);
      if (k === -1 || k >= b) k = -1;
      if (k > i + 1) {
        out.push('<code>');
        out.push(escapeHtml(s.slice(i + 1, k)));
        out.push('</code>');
        i = k + 1;
      } else {
        out.push('`');
        i++;
      }
      continue;
    }
    if (c === 42) {
      if (i + 1 < b && s.charCodeAt(i + 1) === 42) {
        const k = findUnescaped(s, '**', i + 2, b);
        if (k > i + 2) {
          out.push('<strong>');
          inlineRange(s, i + 2, k, link, out);
          out.push('</strong>');
          i = k + 2;
        } else {
          out.push('**');
          i += 2;
        }
        continue;
      }
      const k = findSingleStar(s, i + 1, b);
      if (k > i + 1) {
        out.push('<em>');
        inlineRange(s, i + 1, k, link, out);
        out.push('</em>');
        i = k + 1;
      } else {
        out.push('*');
        i++;
      }
      continue;
    }
    // '[': a link, or itself.
    const k = findUnescaped(s, ']', i + 1, b);
    let m2 = -1;
    if (k !== -1 && k + 1 < b && s.charCodeAt(k + 1) === 40) {
      m2 = s.indexOf(')', k + 2);
      if (m2 === -1 || m2 >= b) m2 = -1;
    }
    const target = m2 === -1 ? '' : s.slice(k + 2, m2);
    if (target !== '' && !/\s/.test(target)) {
      out.push('<a href="');
      out.push(escapeHtml(link(target)));
      out.push('">');
      inlineRange(s, i + 1, k, link, out);
      out.push('</a>');
      i = m2 + 1;
    } else {
      out.push('[');
      i++;
    }
  }
  if (i < b) out.push(s.slice(i, b));
}

function inlineStr(s, link) {
  const out = [];
  inlineRange(s, 0, s.length, link, out);
  return out.join('');
}

function resolvePath(dirParts, rel) {
  const parts = dirParts.slice();
  const segs = rel.split('/');
  for (let k = 0; k < segs.length; k++) {
    const seg = segs[k];
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

function wordsOf(text) {
  let n = 0;
  let inW = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let ws;
    if (c === 32 || (c >= 9 && c <= 13)) ws = true;
    else if (c < 160) ws = false;
    else ws = c === 160 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
    if (ws) inW = false;
    else if (!inW) {
      inW = true;
      n++;
    }
  }
  return n;
}

function uniqLocal(slug, set) {
  if (!set.has(slug)) {
    set.add(slug);
    return slug;
  }
  let n = 2;
  let out = slug + '-' + n;
  while (set.has(out)) {
    n++;
    out = slug + '-' + n;
  }
  set.add(out);
  return out;
}

function renderMarkdown(G, src, link) {
  const lines = src.split('\n');
  const n = lines.length;
  const parts = [];
  const toc = [];
  let excerpt = null;
  const ids = new Set();
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (isBlankStr(line)) {
      i++;
      continue;
    }
    const lang = fenceLang(line);
    if (lang !== null) {
      i++;
      const cls = lang === '' ? '' : ' class="language-' + escapeHtml(lang) + '"';
      const body = [];
      while (i < n && !isFenceClose(lines[i])) body.push(lines[i++]);
      i++;
      parts.push('<pre><code' + cls + '>');
      if (body.length > 0) {
        parts.push(escapeHtml(body.join('\n')));
        parts.push('\n');
      }
      parts.push('</code></pre>');
      parts.push('\n');
      continue;
    }
    const hd = headingOf(line);
    if (hd !== null) {
      const id = uniqLocal(slugify(G, hd.text), ids);
      const html = inlineStr(hd.text, link);
      parts.push('<h' + hd.depth + ' id="' + id + '">' + html + '</h' + hd.depth + '>');
      parts.push('\n');
      if (hd.depth === 2 || hd.depth === 3) toc.push({ level: hd.depth, id, html });
      i++;
      continue;
    }
    if (isHR(line)) {
      parts.push('<hr>');
      parts.push('\n');
      i++;
      continue;
    }
    if (line.charCodeAt(0) === 62) {
      const qlines = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        let l = lines[i++];
        l = l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1);
        l = trimLine(l);
        if (l !== '') qlines.push(l);
      }
      if (qlines.length === 0) {
        parts.push('<blockquote>\n</blockquote>');
      } else {
        parts.push('<blockquote>\n<p>');
        parts.push(inlineStr(qlines.join('\n'), link));
        parts.push('</p>\n</blockquote>');
      }
      parts.push('\n');
      continue;
    }
    const li = listStart(line);
    if (li !== null) {
      const items = [];
      while (i < n) {
        const m = listStart(lines[i]);
        if (m !== null && m.ordered === li.ordered) {
          items.push([trimLine(m.text)]);
          i++;
        } else if (isContinued(lines[i])) {
          items[items.length - 1].push(trimLine(lines[i]));
          i++;
        } else break;
      }
      const tag = li.ordered ? 'ol' : 'ul';
      parts.push(li.ordered && li.start !== 1 ? '<ol start="' + li.start + '">' : '<' + tag + '>');
      parts.push('\n');
      for (let q = 0; q < items.length; q++) {
        parts.push('<li>');
        parts.push(inlineStr(items[q].join('\n'), link));
        parts.push('</li>\n');
      }
      parts.push('</' + tag + '>');
      parts.push('\n');
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inlineStr(body.join('\n'), link);
    if (excerpt === null) excerpt = html;
    parts.push('<p>');
    parts.push(html);
    parts.push('</p>');
    parts.push('\n');
  }
  return { html: parts.join(''), toc, excerpt: excerpt === null ? '' : excerpt };
}

// ---------------------------------------------------------------- templates

class TemplateError extends Error {}

const T_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const T_FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const T_IF = /^if (not )?(\S+)$/;
const T_INCLUDE = /^include "([a-z0-9-]+)"$/;

function pathOf(name, text) {
  if (!T_PATH.test(text)) throw new TemplateError('template "' + name + '": ' + JSON.stringify(text) + ' is not a path');
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError('template "' + name + '": a ' + (raw ? '{{{' : '{{') + ' is not closed');
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError('template "' + name + '": a {% is not closed');
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = T_FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = T_IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError('template "' + name + '": an else outside an if');
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError('template "' + name + '": an ' + tag + ' with no open ' + tag.slice(3));
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = T_INCLUDE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError('template "' + name + '": {% ' + tag + ' %} is not a tag');
    }
  }
  if (stack.length > 1) throw new TemplateError('template "' + name + '": a ' + stack[stack.length - 1].kind + ' is not closed');
  return root.body;
}

// Flatten a node tree into op arrays:
// 0 text, 1 var/raw [path, raw], 2 if [path, not, elsePc, endPc],
// 3 for [name, path, endPc], 4 endfor, 5 else-jump [endPc], 7 include [name].
function flatten(nodes, ops) {
  for (const n of nodes) {
    if (n.kind === 'text') ops.push([0, n.text]);
    else if (n.kind === 'var') ops.push([1, n.path, 0]);
    else if (n.kind === 'raw') ops.push([1, n.path, 1]);
    else if (n.kind === 'if') {
      const op = [2, n.path, n.not ? 1 : 0, -1, -1];
      ops.push(op);
      flatten(n.then, ops);
      if (n.else !== null) {
        const elseOp = [5, -1];
        ops.push(elseOp);
        op[3] = ops.length;
        flatten(n.else, ops);
        elseOp[1] = ops.length;
        op[4] = ops.length;
      } else {
        op[3] = ops.length;
        op[4] = ops.length;
      }
    } else if (n.kind === 'for') {
      const op = [3, n.name, n.path, -1];
      ops.push(op);
      flatten(n.body, ops);
      ops.push([4]);
      op[3] = ops.length;
    } else if (n.kind === 'include') ops.push([7, n.name]);
  }
}

function compileTemplate(name, src) {
  const ops = [];
  flatten(parseTemplate(name, src), ops);
  return ops;
}

function lookup(scope, path) {
  const p0 = path[0];
  if (!(p0 in scope)) return undefined;
  let v = scope[p0];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    let s = '';
    for (let k = 0; k < v.length; k++) {
      if (k > 0) s += ', ';
      s += textOf(v[k]);
    }
    return s;
  }
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

function renderOps(ops, scope, G, depth, out) {
  const T = G.templates;
  let pc = 0;
  const stack = [];
  while (pc < ops.length) {
    const op = ops[pc];
    const kind = op[0];
    if (kind === 0) {
      out.push(op[1]);
      pc++;
    } else if (kind === 1) {
      const v = textOf(lookup(scope, op[1]));
      out.push(op[2] ? v : escapeHtml(v));
      pc++;
    } else if (kind === 2) {
      if (truthy(lookup(scope, op[1])) !== !!op[2]) pc++;
      else pc = op[3];
    } else if (kind === 3) {
      const xs = lookup(scope, op[2]);
      if (!Array.isArray(xs) || xs.length === 0) {
        pc = op[3];
      } else {
        const child = Object.create(scope);
        const loopObj = { index: 1, first: true, last: xs.length === 1, length: xs.length };
        child[op[1]] = xs[0];
        child.loop = loopObj;
        stack.push({ xs, k: 0, endPc: op[3], forPc: pc, name: op[1], parent: scope, child, loopObj });
        scope = child;
        pc++;
      }
    } else if (kind === 4) {
      const fr = stack[stack.length - 1];
      fr.k++;
      if (fr.k < fr.xs.length) {
        fr.child[fr.name] = fr.xs[fr.k];
        fr.loopObj.index = fr.k + 1;
        fr.loopObj.first = fr.k === 0;
        fr.loopObj.last = fr.k === fr.xs.length - 1;
        scope = fr.child;
        pc = fr.forPc + 1;
      } else {
        stack.pop();
        scope = fr.parent;
        pc++;
      }
    } else if (kind === 5) {
      pc = op[1];
    } else {
      const fn = T.get(op[1]);
      if (fn !== undefined && depth < 8) renderOps(fn, scope, G, depth + 1, out);
      pc++;
    }
  }
}

// ---------------------------------------------------------------- build

function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

function linkFor(G, dirParts, srcPath) {
  return function (target) {
    const c0 = target.charCodeAt(0);
    if (c0 === 47 || c0 === 35) return target;
    if ((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122)) {
      let j = 1;
      let scheme = false;
      while (j < target.length) {
        const c = target.charCodeAt(j);
        if (c === 58) {
          scheme = true;
          break;
        }
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) {
          j++;
          continue;
        }
        break;
      }
      if (scheme) return target;
    }
    const hash = target.indexOf('#');
    const rel = hash === -1 ? target : target.slice(0, hash);
    const frag = hash === -1 ? '' : target.slice(hash);
    const path = rel === '' ? null : resolvePath(dirParts, rel);
    if (path !== null) {
      const s = G.bySource.get(path);
      if (s !== undefined) return s.url + frag;
      if (G.staticSet.has(path)) return G.base + '/' + path + frag;
    }
    G.broken.add('broken-link ' + srcPath + ' -> ' + target);
    return target;
  };
}

function cardOf(G, s) {
  if (s.card !== undefined) return s.card;
  const c = {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(G, s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: s.rm,
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  };
  s.card = c;
  return c;
}

function linkOf(G, s) {
  if (s === null) return null;
  return { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(G, s.data.date) };
}

export function run(input) {
  const G = {
    base: input.site.base_url.replace(/\/+$/, ''),
    templates: new Map(),
    slugCache: new Map(),
    dateCache: new Map(),
    taken: new Map(),
    broken: new Set(),
    bySource: new Map(),
    staticSet: new Set(),
    tagFallback: new Map(),
    report: [],
  };
  // Templates, parsed in code-unit order of name.
  for (const name of Object.keys(input.templates).sort()) {
    try {
      G.templates.set(name, compileTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      G.report.push(err.message);
    }
  }

  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      sources.push({ path: f.path, text: f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n') });
    } else statics.push({ path: f.path, content: f.content });
  }
  for (const f of statics) G.staticSet.add(f.path);

  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      G.report.push('refused ' + s.path + ': ' + fm.error);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== undefined) {
      G.report.push('refused ' + s.path + ': ' + own + '/ is the generator\'s own');
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      G.report.push('refused ' + s.path + ': a post needs a date');
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!G.templates.has(layout)) {
      G.report.push('refused ' + s.path + ': layout "' + layout + '" is no template that parses');
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      G.report.push('draft ' + s.path);
      continue;
    }
    s.srcDir = dirOf(s.path);
    kept.push(s);
  }

  for (const s of kept) {
    const dir = s.post ? 'posts' : s.srcDir;
    const slug = uniqueSlug(G, s.data.slug ?? slugify(G, s.data.title), dir);
    s.slug = slug;
    s.outDir = dir === '' ? slug : dir + '/' + slug;
    s.url = G.base + '/' + s.outDir + '/';
    G.bySource.set(s.path, s);
  }

  for (const s of kept) {
    const dirParts = s.srcDir === '' ? [] : s.srcDir.split('/');
    const md = renderMarkdown(G, s.body, linkFor(G, dirParts, s.path));
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
    s.rm = Math.max(1, Math.ceil(wordsOf(s.body) / 200));
  }

  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    const tags = s.data.tags ?? [];
    for (const name of tags) {
      const sl = slugify(G, name);
      if (!seen.has(sl)) {
        seen.add(sl);
        out.push(name);
      }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(G, name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: G.base + '/tags/' + slug + '/', posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map((name) => {
      const slug = slugify(G, name);
      const t = bySlug.get(slug);
      if (t !== undefined) return t;
      let fb = G.tagFallback.get(slug);
      if (fb === undefined) {
        fb = { name, slug, url: '', posts: [] };
        G.tagFallback.set(slug, fb);
      }
      return fb;
    });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  const output = Object.create(null);
  const cards = new Map(posts.map((p) => [p, cardOf(G, p)]));
  const site = { title: input.site.title, base_url: G.base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const render = (name, vars) => {
    const ops = G.templates.get(name);
    if (ops === undefined) return null;
    const out = [];
    const scope = Object.create(null);
    scope.site = site;
    scope.tags = allTags;
    scope.recent = recent;
    for (const k of Object.keys(vars)) scope[k] = vars[k];
    renderOps(ops, scope, G, 0, out);
    return out.join('');
  };
  for (const s of kept) {
    const page = {
      ...cardOf(G, s),
      slug: s.slug,
      content: s.html,
      toc: s.toc,
      newer: linkOf(G, s.newer ?? null),
      older: linkOf(G, s.older ?? null),
      is_post: s.post,
    };
    output[s.outDir + '/index.html'] = render(s.layout, { page });
  }
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? G.base + '/' : G.base + '/page/' + k + '/');
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : 'page/' + k + '/index.html'] = html;
  }
  for (const t of tags) {
    const html = render('tag', {
      tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) },
    });
    if (html !== null) output['tags/' + t.slug + '/index.html'] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) G.report.push('shadowed ' + f.path + ': a built page has its path');
    else output[f.path] = f.content;
  }

  const lines = [...G.report, ...G.broken].sort();
  const pageCount = kept.filter((s) => !s.post).length;
  lines.push('built ' + pageCount + ' pages, ' + posts.length + ' posts, ' + tags.length + ' tags and ' + statics.length + ' static files');
  output['build-report.txt'] = lines.join('\n') + '\n';
  return output;
}
