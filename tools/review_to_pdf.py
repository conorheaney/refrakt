"""Renders a code-review Markdown file (e.g. bobs-code-review-001.md) as a styled A4 PDF.

    python tools/review_to_pdf.py bobs-code-review-001.md [--out bobs-code-review-001.pdf] [--html review.html]

Needs the `markdown` package (pip install markdown) and Chrome or Edge, which prints the page headlessly.
The PDF goes next to the Markdown file unless --out is given; --html also keeps the intermediate page.

Expected Markdown shape (as in the review files):
  - `# <Project> — <Title>` first, then `**Reviewer:**`, `**Date:**`, `**Scope:**` lines, then a `---` rule.
  - An optional `## Contents` section (replaced by a generated contents list).
  - Finding headings like `### S1. Name — High, effort M–L` become severity and effort badges, and a trailing
    `*Confirmed.*` / `*Likely; verify in play.*` / `*Hardening.*` becomes a tag.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import markdown
except ImportError:
    sys.exit("The 'markdown' package is missing: pip install markdown")

BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

CSS = """
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
:root { --ink:#1c2230; --muted:#5d6678; --line:#e2e6ee; --accent:#4b3fd1; --soft:#f5f6fa; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", system-ui, sans-serif; color: var(--ink); font-size: 10pt; line-height: 1.5; margin: 0; }
.cover { border-bottom: 3px solid var(--accent); padding-bottom: 14px; margin-bottom: 18px; }
.cover .kicker { text-transform: uppercase; letter-spacing: .14em; font-size: 8.5pt; color: var(--accent); font-weight: 600; }
.cover h1 { font-size: 26pt; margin: 4px 0 10px; letter-spacing: -.01em; }
.meta { display: grid; grid-template-columns: 80px 1fr; gap: 3px 12px; font-size: 9.5pt; color: var(--muted); }
.meta b { color: var(--ink); font-weight: 600; }
.note { margin-top: 10px; font-size: 9pt; color: var(--muted); }
.note p { margin: 0; }
h2 { font-size: 15pt; color: var(--accent); margin: 26px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--line); break-after: avoid; }
h2#findings-structure, h2#prioritized-roadmap { break-before: page; }
h3 { font-size: 11pt; margin: 18px 0 6px; break-after: avoid; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
p, li { orphans: 3; widows: 3; }
ul, ol { padding-left: 20px; margin: 6px 0; }
li { margin: 2px 0; }
code { font-family: Consolas, "Cascadia Mono", monospace; font-size: 8.8pt; background: var(--soft); padding: 1px 4px; border-radius: 3px; word-break: break-word; }
pre { background: #f3f4f8; border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 4px; padding: 9px 12px; overflow: hidden; white-space: pre-wrap; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 8.5pt; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; font-size: 9pt; break-inside: auto; }
th { background: var(--accent); color: #fff; text-align: left; font-weight: 600; padding: 6px 8px; }
td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr { break-inside: avoid; }
tbody tr:nth-child(even) td { background: #fafbfd; }
strong { font-weight: 600; }
.sev, .eff, .tag { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; padding: 2px 7px; border-radius: 10px; }
.sev-critical { background:#7a0d1e; color:#fff; }
.sev-high { background:#fde2e1; color:#a1231b; }
.sev-medium { background:#fff1d6; color:#8a5a00; }
.sev-low { background:#e3f1e7; color:#21683a; }
.eff { background: var(--soft); color: var(--muted); border: 1px solid var(--line); }
.tag { background:#e8e6fb; color: var(--accent); }
.toc ul { list-style: none; padding-left: 0; columns: 2; }
.toc a { color: var(--ink); text-decoration: none; }
.toc li::before { content: "→ "; color: var(--accent); }
a { color: var(--accent); }
"""

SEVERITY = r"(?:Critical|High|Medium|Low)(?:–(?:Critical|High|Medium|Low))?(?: for the editor)?"


def inline(md_text: str) -> str:
    """Markdown for a single line, without the wrapping <p>."""
    return re.sub(r"^<p>(.*)</p>$", r"\1", markdown.markdown(md_text), flags=re.S)


def badges(match: re.Match) -> str:
    attrs, inner = match.group(1), match.group(2)

    def severity(label: str) -> str:
        key = label.split("–")[0].split(" ")[0].lower()
        return f'<span class="sev sev-{key}">{label}</span>'

    inner = re.sub(rf"— ({SEVERITY}), effort ([SML](?:–[SML])?)",
                   lambda m: f'{severity(m.group(1))}<span class="eff">Effort {m.group(2)}</span>', inner)
    inner = re.sub(r"<em>(Confirmed\.|Likely; verify in play\.|Hardening\.)</em>",
                   lambda m: f'<span class="tag">{m.group(1).rstrip(".")}</span>', inner)
    inner = inner.replace("</span>. <span", "</span><span")
    return f"<h3{attrs}>{inner}</h3>"


def build_html(text: str) -> str:
    head, rest = text.split("\n---\n", 1)

    h1 = re.search(r"^# (.+)$", head, flags=re.M)
    full_title = h1.group(1).strip() if h1 else "Code Review"
    project, _, title = full_title.partition(" — ")
    if not title:
        project, title = "", full_title

    fields = {k: inline(v) for k, v in re.findall(r"^\*\*(\w+):\*\* (.+)$", head, flags=re.M)}
    # Any other paragraphs in the title block (notes, legends) go under the metadata.
    notes = [p for p in re.split(r"\n\s*\n", head)
             if p.strip() and not p.startswith("# ") and not p.startswith("**Reviewer:**")]
    notes_html = "".join(markdown.markdown(p) for p in notes)

    # Swap the hand-written contents list (only the list; any legend after it stays) for a generated one.
    rest = re.sub(r"(## Contents\n\n)(?:\s*(?:\d+\.|[-*]) .*\n)+", r"\1[TOC]\n\n", rest)
    rest = re.sub(r"\n---\n", "\n", rest)
    # Fenced blocks indented inside list items: dedent so fenced_code picks them up.
    rest = re.sub(r"\n\n( +)```(\w*)\n(.*?)\n\1```",
                  lambda m: "\n\n```" + m.group(2) + "\n"
                  + re.sub(r"^" + m.group(1), "", m.group(3), flags=re.M) + "\n```",
                  rest, flags=re.S)

    md = markdown.Markdown(extensions=["tables", "fenced_code", "toc", "sane_lists"],
                           extension_configs={"toc": {"toc_depth": "2-2"}})
    body = md.convert(rest)
    body = re.sub(r'<li><a href="#contents">Contents</a></li>\s*', "", body)
    body = re.sub(r"<h3([^>]*)>(.*?)</h3>", badges, body)

    meta = "".join(f"<b>{k}</b><span>{v}</span>" for k, v in fields.items())
    kicker = f"Code review · {project}" if project else "Code review"
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{full_title}</title>
<style>{CSS}</style></head><body>
<div class="cover">
  <div class="kicker">{kicker}</div>
  <h1>{title}</h1>
  <div class="meta">{meta}</div>
  <div class="note">{notes_html}</div>
</div>
{body}
</body></html>"""


def find_browser() -> str:
    for path in BROWSERS:
        if os.path.exists(path):
            return path
    for name in ("chrome", "google-chrome", "chromium", "msedge"):
        found = shutil.which(name)
        if found:
            return found
    sys.exit("Could not find Chrome or Edge to print the PDF.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("markdown_file", type=Path)
    parser.add_argument("--out", type=Path, help="PDF path (default: next to the Markdown file)")
    parser.add_argument("--html", type=Path, help="also keep the intermediate HTML here")
    args = parser.parse_args()

    src = args.markdown_file.resolve()
    out = (args.out or src.with_suffix(".pdf")).resolve()
    html = build_html(src.read_text(encoding="utf-8"))

    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "review.html"
        page.write_text(html, encoding="utf-8")
        if args.html:
            args.html.write_text(html, encoding="utf-8")
        subprocess.run([find_browser(), "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                        f"--user-data-dir={Path(tmp) / 'profile'}",
                        f"--print-to-pdf={out}", page.as_uri()],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if not out.exists():
        sys.exit("The browser did not write the PDF.")
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
