import { promises as fs } from "node:fs";
import path from "node:path";

const imagesRoot = "source/images";
const outFile = "source/gallery/index.html";
const exts = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p)));
    else files.push(p);
  }
  return files;
}

function toSiteUrl(filePath) {
  return "/" + filePath.replaceAll("\\", "/").replace(/^source\//, "");
}

function parseSimpleYaml(text) {
  const obj = {};
  for (const line of text.split(/\r?\n/)) {
    let s = line.trim();
    if (!s || s.startsWith("#")) continue;

    const i = s.indexOf(":");
    if (i === -1) continue;

    const key = s.slice(0, i).trim();
    let val = s.slice(i + 1).trim();

    // 去掉行内注释：key: value # comment
    if (!(val.startsWith('"') || val.startsWith("'"))) {
      const hash = val.indexOf("#");
      if (hash !== -1) val = val.slice(0, hash).trim();
    }

    // 去掉包裹引号
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }

    obj[key] = val;
  }
  return obj;
}

// 仍保留：单张图片的元数据（可选，不用也没事）
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

// 相册（目录）元数据：source/images/<album>/album.yml|yaml|json
async function readAlbumMeta(albumDir) {
  for (const p of ["album.yml", "album.yaml", "album.json"]) {
    const file = path.join(albumDir, p);
    try {
      const raw = await fs.readFile(file, "utf8");
      const data = p.endsWith(".json") ? JSON.parse(raw) : parseSimpleYaml(raw);
      return {
        title: (data.title || "").toString().trim(),
        date: (data.date || "").toString().trim(),
        desc: (data.desc || "").toString().trim(),
      };
    } catch {
      // ignore
    }
  }
  return { title: "", date: "", desc: "" };
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

  // albumDir -> [imgPath...]
  const albums = new Map();
  for (const imgPath of files) {
    const albumDir = path.dirname(imgPath);
    if (!albums.has(albumDir)) albums.set(albumDir, []);
    albums.get(albumDir).push(imgPath);
  }

  const albumDirs = Array.from(albums.keys());

  // 读取相册元数据用于排序
  const albumInfo = await Promise.all(
    albumDirs.map(async (dir) => {
      const meta = await readAlbumMeta(dir);
      return { dir, date: meta.date || "" };
    })
  );

  // date 倒序（YYYY-MM-DD 字符串可直接比较），无 date 排最后
  albumInfo.sort((a, b) => {
    if (a.date && b.date) {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
    } else if (a.date && !b.date) return -1;
    else if (!a.date && b.date) return 1;

    return a.dir.localeCompare(b.dir, "en", { numeric: true });
  });

  const sortedAlbumDirs = albumInfo.map((x) => x.dir);

  const sections = [];
  for (const albumDir of sortedAlbumDirs) {
    const albumMeta = await readAlbumMeta(albumDir);
    const albumNameFallback = path.basename(albumDir);

    const albumTitle = albumMeta.title || albumNameFallback;
    const albumDate = albumMeta.date || "";
    const albumDesc = albumMeta.desc || "";

    const imgs = albums
      .get(albumDir)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

    const cards = imgs
      .map((p) => {
        const url = toSiteUrl(p);
        const alt = path.parse(p).name;

        const html = `<figure class="gallery-card">
  <a class="gallery-link" href="${url}" target="_blank" rel="noopener">
    <img src="${url}" alt="${escapeHtml(alt)}">
  </a>
</figure>`;

        return html
          .split("\n")
          .map((line) => "      " + line) // 6 spaces
          .join("\n");
      })
      .join("\n");

    sections.push(`
<section class="album">
  <details class="album-details">
    <summary class="album-header">
      <span class="album-arrow" aria-hidden="true"></span>
      <span class="album-header-text">
        <span class="album-title">${escapeHtml(albumTitle)}</span>
        ${albumDate ? `<span class="album-date">${escapeHtml(albumDate)}</span>` : ""}
        ${albumDesc ? `<span class="album-desc">${escapeHtml(albumDesc)}</span>` : ""}
      </span>
    </summary>
    <div class="gallery-grid">
${cards}
    </div>
  </details>
</section>`.trim());
  }

  const md = `---
title: 相册
date: ${new Date().toISOString().slice(0, 10)}
layout: page
---

<div class="gallery-page">
${sections.join("\n\n")}
</div>
`;

  await fs.writeFile(outFile, md, "utf8");
  console.log(
    `Generated ${outFile} with ${files.length} images in ${albumDirs.length} albums`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});