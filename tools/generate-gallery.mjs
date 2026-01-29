import { promises as fs } from "node:fs";
import path from "node:path";

const imagesRoot = "source/images";
const outFile = "source/gallery/index.md";
const exts = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...await walk(p));
    else files.push(p);
  }
  return files;
}

function toSiteUrl(filePath) {
  return "/" + filePath.replaceAll("\\", "/").replace(/^source\//, "");
}

// 极简 YAML：只支持 key: value（不支持嵌套/数组）
function parseSimpleYaml(text) {
  const obj = {};
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const i = s.indexOf(":");
    if (i === -1) continue;
    const key = s.slice(0, i).trim();
    let val = s.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    obj[key] = val;
  }
  return obj;
}

async function readMeta(imgPath) {
  const base = imgPath.replace(path.extname(imgPath), "");
  for (const p of [base + ".yml", base + ".yaml", base + ".json"]) {
    try {
      const buf = await fs.readFile(p, "utf8");
      if (p.endsWith(".json")) return JSON.parse(buf);
      return parseSimpleYaml(buf);
    } catch {
      // ignore
    }
  }
  return {};
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function main() {
  await fs.mkdir(path.dirname(outFile), { recursive: true });

  let files = await walk(imagesRoot);
  files = files
    .filter((f) => exts.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

  const items = [];
  for (const imgPath of files) {
    const url = toSiteUrl(imgPath);
    const meta = await readMeta(imgPath);

    const title = meta.title || path.parse(imgPath).name;
    const date = meta.date || "";
    const desc = meta.desc || "";

    items.push(`
  <figure class="gallery-card">
    <a class="gallery-link" href="${url}" target="_blank" rel="noopener">
      <img src="${url}" alt="${escapeHtml(title)}">
    </a>
    <figcaption class="gallery-meta">
      <div class="gallery-title">${escapeHtml(title)}</div>
      ${date ? `<div class="gallery-date">${escapeHtml(date)}</div>` : ""}
      ${desc ? `<div class="gallery-desc">${escapeHtml(desc)}</div>` : ""}
    </figcaption>
  </figure>`.trim());
  }

  const md = `---
title: 相册
date: ${new Date().toISOString().slice(0, 10)}
---

<div class="gallery-grid">
${items.join("\n")}
</div>
`;

  await fs.writeFile(outFile, md, "utf8");
  console.log(`Generated ${outFile} with ${files.length} images`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});