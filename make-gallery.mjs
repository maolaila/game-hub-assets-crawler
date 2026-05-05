import fs from 'fs';
import path from 'path';

const root = process.argv[2];

if (!root) {
  console.error('用法：node make-gallery.mjs "./assets-dump-xxxx"');
  process.exit(1);
}

const filesDir = path.join(root, 'files');
const output = path.join(root, 'preview.html');

const files = fs.readdirSync(filesDir);

const images = files.filter((f) =>
  /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(f)
);

const audios = files.filter((f) =>
  /\.(mp3|ogg|wav)$/i.test(f)
);

const jsons = files.filter((f) =>
  /\.json$/i.test(f)
);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>Assets Preview</title>
<style>
  body {
    font-family: Arial, sans-serif;
    padding: 20px;
    background: #f5f5f5;
  }
  h1, h2 {
    margin-top: 30px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
  }
  .card {
    background: white;
    border-radius: 8px;
    padding: 10px;
    word-break: break-all;
    box-shadow: 0 1px 4px rgba(0,0,0,0.12);
  }
  img {
    max-width: 100%;
    max-height: 140px;
    object-fit: contain;
    background: #ddd;
  }
  audio {
    width: 100%;
  }
  .filename {
    font-size: 12px;
    margin-top: 8px;
  }
</style>
</head>
<body>
<h1>Assets Preview</h1>

<h2>Images: ${images.length}</h2>
<div class="grid">
${images.map((f) => `
  <div class="card">
    <img src="./files/${f}" />
    <div class="filename">${f}</div>
  </div>
`).join('')}
</div>

<h2>Audio: ${audios.length}</h2>
<div class="grid">
${audios.map((f) => `
  <div class="card">
    <audio controls src="./files/${f}"></audio>
    <div class="filename">${f}</div>
  </div>
`).join('')}
</div>

<h2>JSON: ${jsons.length}</h2>
<ul>
${jsons.map((f) => `<li><a href="./files/${f}" target="_blank">${f}</a></li>`).join('')}
</ul>

</body>
</html>`;

fs.writeFileSync(output, html, 'utf-8');

console.log('预览文件已生成：');
console.log(output);