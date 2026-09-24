// วาดรูปเสื้อเป็น SVG ตามทรงและสี ไม่ต้องมีไฟล์รูป
// ถ้ามีรูปถ่ายจริง เปลี่ยนไปใช้ <img> แทนได้เลย

const SHIRT_PATHS = {
  tee: "M104 42 Q150 66 196 42 L252 64 L286 124 L246 142 L228 116 L230 272 L70 272 L72 116 L54 142 L14 124 L48 64 Z",
  polo: "M104 42 Q150 66 196 42 L252 64 L286 124 L246 142 L228 116 L230 272 L70 272 L72 116 L54 142 L14 124 L48 64 Z",
  oversize: "M98 40 Q150 66 202 40 L262 68 L294 150 L250 164 L238 128 L242 278 L58 278 L62 128 L50 164 L6 150 L38 68 Z",
  long: "M104 42 Q150 66 196 42 L250 62 L292 238 L262 248 L228 128 L230 272 L70 272 L72 128 L38 248 L8 238 L50 62 Z",
  tank: "M108 30 L126 30 Q150 96 174 30 L192 30 Q196 94 226 112 L226 272 L74 272 L74 112 Q104 94 108 30 Z",
};

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function shirtSVG(shape, color, print) {
  const light = luminance(color) > 0.6;
  const edge = light ? "rgba(20,24,40,.28)" : "rgba(0,0,0,.35)";
  const fold = light ? "rgba(20,24,40,.10)" : "rgba(255,255,255,.08)";
  const ink = light ? "#17192A" : "#F4F2EC";
  let extra = "";

  if (shape === "tank") {
    extra = `<path d="M126 30 Q150 96 174 30" fill="none" stroke="${edge}" stroke-width="3"/>`;
  } else {
    extra = `<path d="M104 42 Q150 76 196 42" fill="none" stroke="${edge}" stroke-width="5"/>`;
  }
  if (shape === "polo") {
    extra = `<path d="M104 42 L132 84 L150 60 L168 84 L196 42 Q150 58 104 42 Z" fill="${color}" stroke="${edge}" stroke-width="2.5"/>
      <line x1="150" y1="60" x2="150" y2="118" stroke="${edge}" stroke-width="2.5"/>
      <circle cx="150" cy="80" r="3" fill="${edge}"/><circle cx="150" cy="102" r="3" fill="${edge}"/>`;
  }

  let printSVG = "";
  if (print) {
    const lines = print.split("\n");
    const longest = Math.max(...lines.map(l => l.length));
    const size = Math.min(34, Math.floor(150 / Math.max(longest, 3) * 1.25));
    const top = 150 - (lines.length - 1) * size * 0.6;
    printSVG = `<text x="150" y="${top}" text-anchor="middle" font-family="Mitr, sans-serif" font-weight="600" font-size="${size}" fill="${ink}">` +
      lines.map((l, i) => `<tspan x="150" dy="${i ? size * 1.15 : 0}">${esc(l)}</tspan>`).join("") + `</text>`;
  }

  return `<svg viewBox="0 0 300 300" role="img" aria-hidden="true">
    <path d="${SHIRT_PATHS[shape] || SHIRT_PATHS.tee}" fill="${color}" stroke="${edge}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M110 200 Q150 214 190 196 M96 250 Q140 240 178 256" fill="none" stroke="${fold}" stroke-width="3" stroke-linecap="round"/>
    ${extra}${printSVG}
  </svg>`;
}
