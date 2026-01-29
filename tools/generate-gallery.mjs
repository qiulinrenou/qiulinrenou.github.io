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
    // 简化规则：如果 val 不是以引号开头，则把第一个 # 及后面都当注释去掉
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

  // 相册目录排序（如需按 album.yml 的 date 排序，可以后续再改）
  const albumDirs = Array.from(albums.keys()).sort((a, b) =>
    a.localeCompare(b, "en", { numeric: true })
  );

  const sections = [];
  for (const albumDir of albumDirs) {
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
        return `
  <figure class="gallery-card">
    <a class="gallery-link" href="${url}" target="_blank" rel="noopener">
      <img src="${url}" alt="${escapeHtml(alt)}">
    </a>
  </figure>`.trim();
      })
      .join("\n");

    sections.push(`
<section class="album">
  <header class="album-header">
    <div class="album-title">${escapeHtml(albumTitle)}</div>
    ${albumDate ? `<div class="album-date">${escapeHtml(albumDate)}</div>` : ""}
    ${albumDesc ? `<div class="album-desc">${escapeHtml(albumDesc)}</div>` : ""}
  </header>
  <div class="gallery-grid">
${cards}
  </div>
</section>`.trim());
  }

  const md = `---
title: 相册
date: ${new Date().toISOString().slice(0, 10)}
---

${sections.join("\n\n")}
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