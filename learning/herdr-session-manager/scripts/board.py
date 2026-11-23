#!/usr/bin/env python3
"""board.py: turn state/sessions.tsv into ONE local HTML page. No server, no account, no network.

  python3 scripts/board.py                      reads state/sessions.tsv, writes state/board.html
  python3 scripts/board.py in.tsv out.html      explicit paths
  python3 scripts/board.py --selftest           planted-input checks (exit 1 on a miss)

The master writes every status word into the TSV. This script never guesses one:
a column it does not know is an error, not a default.
Columns, in this order: Needs you | To do | In progress | Testing | Done
Fields (tab separated, first line is the header): name, column, does, stands, needs_from_you, link, updated
"""
import html, json, os, sys

COLS = ["Needs you", "To do", "In progress", "Testing", "Done"]
FIELDS = ["name", "column", "does", "stands", "needs_from_you", "link", "updated"]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    rows, bad = [], []
    lines = open(path, encoding="utf-8").read().splitlines()
    for n, ln in enumerate(lines[1:], start=2):
        if not ln.strip():
            continue
        r = dict(zip(FIELDS, (ln.split("\t") + [""] * len(FIELDS))[: len(FIELDS)]))
        canon = {c.lower(): c for c in COLS}.get(r["column"].strip().lower())
        if not canon:
            bad.append("line %d: '%s' has column '%s', expected one of %s" % (n, r["name"], r["column"], ", ".join(COLS)))
            continue
        r["column"] = canon
        link = r["link"].strip()
        r["link"] = link if link.startswith(("http://", "https://")) else ""  # only real links, never javascript:
        rows.append(r)
    return rows, bad


def start_here(rows):
    first = next((r for r in rows if r["column"] == "Needs you"), None)
    if first:
        return "Start here: %s. %s" % (first["name"], first["needs_from_you"])
    return "Start here: nothing needs you right now."


PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sessions board</title>
<style>
:root{--bg:#f7f7f4;--card:#fff;--ink:#1c1f1d;--mute:#6b706c;--line:#e2e4df;--accent:#1f6f4a}
@media (prefers-color-scheme:dark){:root{--bg:#121513;--card:#1b1f1c;--ink:#ecefe9;--mute:#9aa29b;--line:#2c322d;--accent:#58c08a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,sans-serif}
header{padding:20px 16px 8px;max-width:1200px;margin:auto}h1{font-size:20px;margin:0 0 4px}
.built{color:var(--mute);font-size:13px}
.start{margin:12px 0 0;padding:12px 14px;border-left:4px solid var(--accent);background:var(--card);border-radius:6px;font-weight:600}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;padding:12px 16px 40px;max-width:1200px;margin:auto}
.col h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);margin:0 0 8px}
.col.empty{display:none}.empty-note{max-width:1200px;margin:0 auto;padding:0 16px 16px;color:var(--mute);font-size:13px}
.col.attn h2{color:var(--accent)}.col.attn .card{border-left:3px solid var(--accent)}
.card{display:block;width:100%;text-align:left;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:0 0 8px;font:inherit;cursor:pointer}
.card:hover,.card:focus-visible{border-color:var(--accent);outline:none}.card b{display:block}.card span{color:var(--mute);font-size:14px}
details summary{cursor:pointer;color:var(--mute);font-size:14px;margin-bottom:8px}
dialog{border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);max-width:min(520px,92vw);padding:18px}
dialog::backdrop{background:rgba(0,0,0,.45)}dialog h3{margin:0 0 10px}dialog dt{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);margin-top:12px}
dialog dd{margin:2px 0 0}dialog a{color:var(--accent)}dialog button{margin-top:16px;padding:8px 14px;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:6px;font:inherit}
</style></head><body>
<header><h1>Sessions board</h1><div class="built">Built __BUILT__ from state/sessions.tsv</div><div class="start" id="start">__START__</div></header>
<main id="board"></main><div class="empty-note" id="emptynote"></div>
<dialog id="dlg"><h3 id="d-name"></h3><dl><dt>What it does</dt><dd id="d-does"></dd><dt>Where it stands</dt><dd id="d-stands"></dd>
<dt>What it needs from you</dt><dd id="d-needs"></dd><dt>Open link</dt><dd id="d-link"></dd><dt>Last updated</dt><dd id="d-upd"></dd></dl>
<button id="d-close">Close</button></dialog>
<script>
const COLS=__COLS__, ROWS=__ROWS__;
const board=document.getElementById('board'), dlg=document.getElementById('dlg');
const t=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e};
function open(r){d('d-name',r.name);d('d-does',r.does);d('d-stands',r.stands);d('d-needs',r.needs_from_you);d('d-upd',r.updated);
 const l=document.getElementById('d-link');l.textContent='';
 if(r.link){const a=t('a','',r.link);a.href=r.link;a.target='_blank';a.rel='noopener';l.append(a)}else l.textContent='none';dlg.showModal()}
function d(id,v){document.getElementById(id).textContent=v||'-'}
const emptyNames=[];
COLS.forEach(c=>{const rs=ROWS.filter(r=>r.column===c);
 if(!rs.length){emptyNames.push(c);return}
 const col=t('section','col'+(c==='Needs you'?' attn':''));col.append(t('h2','',c+' ('+rs.length+')'));
 const mk=r=>{const b=t('button','card');b.append(t('b','',r.name),t('span','',r.does));b.onclick=()=>open(r);return b};
 if(c==='Done'){const dt=document.createElement('details');dt.append(t('summary','',rs.length+' done, tap to show'));rs.forEach(r=>dt.append(mk(r)));col.append(dt)}
 else rs.forEach(r=>col.append(mk(r)));
 board.append(col)});
document.getElementById('emptynote').textContent=emptyNames.length?'Empty: '+emptyNames.join(', '):'';
document.getElementById('d-close').onclick=()=>dlg.close();
</script></body></html>"""


def build(rows, built):
    j = lambda o: json.dumps(o, ensure_ascii=False).replace("</", "<\\/")
    return (PAGE.replace("__BUILT__", html.escape(built)).replace("__START__", html.escape(start_here(rows)))
            .replace("__COLS__", j(COLS)).replace("__ROWS__", j(rows)))


def selftest():
    import tempfile, datetime
    d = tempfile.mkdtemp(); bad = 0
    good = os.path.join(d, "g.tsv")
    open(good, "w").write("\t".join(FIELDS) + "\nA\tNeeds you\tdo\tst\tpick one\thttps://x.test\tnow\nB\tDone\tdo\tst\tNothing\tjavascript:alert(1)\tnow\n")
    rows, errs = read(good)
    bad += 0 if (len(rows) == 2 and not errs) else 1                       # a valid file reads clean
    bad += 0 if rows[1]["link"] == "" else 1                                # a javascript: link is dropped
    bad += 0 if start_here(rows).startswith("Start here: A. pick one") else 1
    bad += 0 if start_here(rows[1:]) == "Start here: nothing needs you right now." else 1
    broken = os.path.join(d, "b.tsv")
    open(broken, "w").write("\t".join(FIELDS) + "\nA\tWorking on it\tdo\tst\tn\tnone\tnow\n")  # planted: an unknown column word
    rows, errs = read(broken)
    bad += 0 if (errs and not rows) else 1                                  # must be refused, never guessed into a column
    page = build(read(good)[0], "t")
    bad += 0 if "</script><script" not in page and "pick one" in page else 1
    print("selftest", "FAIL" if bad else "PASS", "(%d misses)" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    import datetime
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    src = a[0] if a else os.path.join(ROOT, "state", "sessions.tsv")
    out = a[1] if len(a) > 1 else os.path.join(ROOT, "state", "board.html")
    rows, errs = read(src)
    if errs:
        print("board: refused, fix these lines in %s:" % src, *errs, sep="\n  ", file=sys.stderr)
        sys.exit(1)
    open(out, "w", encoding="utf-8").write(build(rows, datetime.datetime.now().strftime("%a %-d %b %Y, %H:%M")))
    print("board: wrote %s (%d cards)" % (out, len(rows)))
