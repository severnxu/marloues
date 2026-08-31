const sharp = require("/Users/severnxu/workspace/personal/marloues/node_modules/sharp");

// Rounded rect path with proper arc corners (visible rounding at 64px)
function roundedRectPath(size, r) {
  const s = size;
  return `M ${r} 0 L ${s - r} 0 A ${r} ${r} 0 0 1 ${s} ${r} L ${s} ${s - r} A ${r} ${r} 0 0 1 ${s - r} ${s} L ${r} ${s} A ${r} ${r} 0 0 1 0 ${s - r} L 0 ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
}

const CANVAS = 512;
// 78% of canvas — slightly smaller than the old 82% so corners read at dock size
const ICON_SIZE = 400;
const ICON_OFFSET = (CANVAS - ICON_SIZE) / 2; // 56px padding
// Apple-standard corner radius: ~22.37% of icon size
const CORNER_RADIUS = Math.floor(ICON_SIZE * 0.2237); // ~89px
const squircle = roundedRectPath(ICON_SIZE, CORNER_RADIUS);

// Monkey: fill 88% of the squircle for strong visibility at 64px
const MONKEY_TARGET = Math.floor(ICON_SIZE * 0.88);
const MONKEY_SCALE = MONKEY_TARGET / 32;
const MONKEY_OFFSET = (CANVAS - 32 * MONKEY_SCALE) / 2;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#B8916A"/>
      <stop offset="100%" stop-color="#8A6640"/>
    </linearGradient>
    <clipPath id="squircleClip">
      <path d="${squircle}" transform="translate(${ICON_OFFSET}, ${ICON_OFFSET})"/>
    </clipPath>
  </defs>
  <g transform="translate(${ICON_OFFSET}, ${ICON_OFFSET})">
    <path d="${squircle}" fill="url(#bgGrad)"/>
  </g>
  <g transform="translate(${MONKEY_OFFSET}, ${MONKEY_OFFSET}) scale(${MONKEY_SCALE}) translate(0, -1.72)">
    <path fill="#6D4534" d="M3.703 10.544a2.24 2.24 0 0 0 .012 1.892l.62 1.311a5.47 5.47 0 0 0 3.827 3.525c-2.904 2.145-5.917 5.99-6.006 11.416c.01.302.219 1.112.844 1.312h3.5c-.366-4.455 2.47-8.568 5.34-9.937l3.13 3.297c-2.691.703-4.735 3.285-4.951 6.14c-.02.276.205.5.481.5h11.339c1.377.008 3.161-.989 3.161-3.17v-.004a5.2 5.2 0 0 0 2.667-.903c1.384-.943 2.409-2.595 2.348-4.759c-.095-3.374-1.993-5.261-3.54-6.644l-.427-.379c-.604-.534-1.084-.958-1.463-1.426c-.42-.518-.616-.978-.616-1.528c0-.777.427-1.157.983-1.272c.635-.132 1.294.121 1.616.663a1.375 1.375 0 0 0 2.364-1.406c-1.006-1.693-2.926-2.284-4.537-1.95c-1.69.35-3.176 1.743-3.176 3.965c0 1.357.54 2.409 1.23 3.26c.537.663 1.23 1.273 1.84 1.81l.353.313c1.438 1.285 2.563 2.5 2.624 4.672c.033 1.178-.496 1.965-1.148 2.408a2.4 2.4 0 0 1-1.118.42v-2.206c-.206-2.598-2.191-8.004-8.48-8.839a3 3 0 0 0-.508-.023l.27-.566a2.23 2.23 0 0 0 .014-1.89l-.812-1.766a5.46 5.46 0 0 0-4.992-3.249H9.5a5.46 5.46 0 0 0-5 3.268z"/>
    <path fill="#E39D89" d="M5.531 9.477c0-1.229.996-2.225 2.225-2.225h4.48c1.229 0 2.225.996 2.225 2.225v.07c0 .791-.413 1.486-1.036 1.88a3.473 3.473 0 1 1-6.858 0a2.22 2.22 0 0 1-1.036-1.88zm-1.488 1.511c0-.806.175-1.572.49-2.262a2.652 2.652 0 0 0-.186 5.055a5.5 5.5 0 0 1-.304-1.8zm11.907.992c0 .636-.11 1.246-.309 1.813a2.652 2.652 0 0 0-.185-5.076c.317.692.493 1.46.493 2.271zM5.5 27.5A2.5 2.5 0 0 0 3 30h5a2.5 2.5 0 0 0-2.5-2.5m14 0A2.5 2.5 0 0 0 17 30h5a2.5 2.5 0 0 0-2.5-2.5"/>
    <path fill="#BB1D80" d="M9.996 14.957a1.984 1.984 0 0 0 1.984-1.984H8.012c0 1.096.888 1.984 1.984 1.984"/>
    <path fill="#FF8687" d="M8.833 11.485c0-.296.24-.535.535-.535h1.225a.535.535 0 0 1 0 1.07H9.368a.535.535 0 0 1-.535-.535"/>
    <path fill="#1C1C1C" d="M8.02 9.475a.49.49 0 0 1 .98 0v1.035a.49.49 0 1 1-.98 0zm1.432 2.433a.246.246 0 1 0 0-.493a.246.246 0 0 0 0 .493m1.079 0a.246.246 0 1 0 0-.493a.246.246 0 0 0 0 .493m.979-2.924a.49.49 0 0 0-.49.49v1.036a.49.49 0 1 0 .98 0V9.475a.49.49 0 0 0-.49-.49"/>
  </g>
</svg>`;

const outDir = "/Users/severnxu/workspace/personal/marloues/client";

async function generate() {
  await sharp(Buffer.from(svg)).resize(CANVAS, CANVAS).png().toFile(`${outDir}/resources/dock-icon.png`);
  console.log("dock-icon.png generated");
  await sharp(Buffer.from(svg)).resize(CANVAS, CANVAS).png().toFile(`${outDir}/build/icon.png`);
  console.log("build/icon.png generated");
  const svg1024 = svg.replace(`width="${CANVAS}" height="${CANVAS}"`, `width="1024" height="1024"`);
  await sharp(Buffer.from(svg1024)).resize(1024, 1024).png().toFile(`${outDir}/build/icon@2x.png`);
  console.log("build/icon@2x.png generated");

  // Pixel analysis
  const { data } = await sharp(`${outDir}/resources/dock-icon.png`).resize(64, 64).raw().toBuffer({ resolveWithObject: true });
  let opaque = 0, total = 64 * 64;
  for (let i = 0; i < data.length; i += 4) { if (data[i+3] > 128) opaque++; }
  console.log(`At 64px dock: ${(opaque/total*100).toFixed(1)}% opaque (was 61.9%)`);

  const { data: fullData } = await sharp(`${outDir}/resources/dock-icon.png`).raw().toBuffer({ resolveWithObject: true });
  let topPad = 512, leftPad = 512;
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const idx = (y * 512 + x) * 4;
    if (fullData[idx+3] > 128) { if (y < topPad) topPad = y; if (x < leftPad) leftPad = x; }
  }
  console.log(`Padding: ${topPad}px (was 46px), Content: ${512-2*leftPad}px = ${((512-2*leftPad)/512*100).toFixed(0)}% (was 82%)`);
  console.log(`Corner radius: ${CORNER_RADIUS}px (${(CORNER_RADIUS/ICON_SIZE*100).toFixed(1)}% of icon)`);
}

generate().catch(err => console.error("Error:", err));
