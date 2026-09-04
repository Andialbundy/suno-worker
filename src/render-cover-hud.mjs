import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { chromium } from 'playwright'

const SIZE = 1024

const cfg = JSON.parse(readFileSync(new URL('./cover-hud.json', import.meta.url), 'utf8'))
const brandSvg = cfg.brandSvg && readFileSync(cfg.brandSvg, 'utf8')
const display = cfg.fonts.display
const gl = (c) => `rgba(${parseInt(c.slice(1, 3), 16)},${parseInt(c.slice(3, 5), 16)},${parseInt(c.slice(5, 7), 16)},`

function buildHtml({ baseImg, artist, title }) {
  const artistCfg = cfg.artists[artist]
  if (!artistCfg) throw new Error(`No cover-hud config for artist ${artist}`)
  const tg = artistCfg.titleGradient.join(', ')
  return `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:${SIZE}px; height:${SIZE}px; overflow:hidden; }
  .base { position:absolute; inset:0; width:${SIZE}px; height:${SIZE}px; object-fit:cover; }
  .vig { position:absolute; inset:0;
    background:
      linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 40%, rgba(3,6,10,0.55) 72%, rgba(2,4,8,0.85) 100%),
      linear-gradient(0deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 55%, rgba(2,5,10,0.5) 100%); }
  /* cyberpunk HUD frame */
  .frame { position:absolute; inset:22px; }
  .corner { position:absolute; width:64px; height:64px; border:3px solid ${artistCfg.accent};
    filter:drop-shadow(0 0 8px ${gl(artistCfg.accent)}0.6));
    box-sizing:border-box; }
  .corner.tl { top:0; left:0; border-right:none; border-bottom:none; }
  .corner.tr { top:0; right:0; border-left:none; border-bottom:none; }
  .corner.bl { bottom:0; left:0; border-right:none; border-top:none; }
  .corner.br { bottom:0; right:0; border-left:none; border-top:none; }
  .hline { position:absolute; left:22px; right:22px; height:2px;
    background:linear-gradient(90deg, transparent, ${gl(artistCfg.accent)}0.55)), ${gl(artistCfg.accent)}0.55)), transparent);
    }
  .hline.top { top:22px; }
  .hline.bot { bottom:22px; }
  .vline { position:absolute; top:22px; bottom:22px; width:2px;
    background:linear-gradient(180deg, transparent, ${gl(artistCfg.accent)}0.4)), ${gl(artistCfg.accent)}0.4)), transparent);
    }
  .vline.le { left:22px; }
  .vline.re { right:22px; }
  .tick { position:absolute; width:2px; height:14px; background:${artistCfg.accent};
    filter:drop-shadow(0 0 6px ${gl(artistCfg.accent)}0.8)); }
  .tick.le { left:22px; top:44px; }
  .tick.le2 { left:22px; top:72px; }
  .tick.re { right:22px; top:44px; }
  .tick.re2 { right:22px; top:72px; }
  .tick.top { top:22px; left:44px; transform:rotate(90deg); width:14px; height:2px; background:${artistCfg.accent}; }
  /* top accent line */
  .accent { position:absolute; top:22px; left:22px; right:22px; height:3px;
    background: linear-gradient(90deg, ${artistCfg.accent}, ${artistCfg.accent2}, transparent); }
  .top { position:absolute; top:60px; left:52px; right:52px; display:flex; justify-content:space-between; align-items:center; }
  .badge { font-family:'${display}',sans-serif; font-weight:700; font-size:34px; letter-spacing:10px;
    color:#fff; text-transform:uppercase;
    text-shadow:0 0 14px ${gl(artistCfg.accent)}0.7); }
  .badge .d { color:${artistCfg.accent}; }
  .badgebar { display:flex; align-items:center; gap:16px; }
  .segline { display:flex; gap:6px; }
  .segline i { width:26px; height:6px; background:${gl(artistCfg.accent)}0.9); box-shadow:0 0 6px ${gl(artistCfg.accent)}0.8)); }
  /* title block: bottom-left, at logo height, never touching logo */
  .titwrap { position:absolute; left:52px; right:220px; bottom:60px; text-align:left; }
  .rule { width:120px; height:3px; margin:0 0 18px; background:linear-gradient(90deg,${artistCfg.accent},${artistCfg.accent2});
    box-shadow:0 0 10px ${gl(artistCfg.accent)}0.6)); }
  .title { font-family:'${display}',sans-serif; font-weight:900; font-size:72px; line-height:0.98;
    background:linear-gradient(180deg, ${tg});
    -webkit-background-clip:text; background-clip:text; color:transparent;
    filter:drop-shadow(0 0 22px ${gl(artistCfg.accent)}0.35)); text-transform:uppercase; }
  /* brand logo: symbol only, bottom-right, watermark style */
  .logo { position:absolute; right:48px; bottom:44px; width:88px; height:auto; opacity:0.35;
    filter:drop-shadow(0 0 6px ${gl(artistCfg.accent)}0.25)); }
  .logo svg { width:88px; height:auto; }
  </style></head><body>
  <img class="base" src="file://${baseImg}"/>
  <div class="vig"></div>
  <div class="frame">
    <div class="corner tl"></div><div class="corner tr"></div>
    <div class="corner bl"></div><div class="corner br"></div>
    <div class="hline top"></div><div class="hline bot"></div>
    <div class="vline le"></div><div class="vline re"></div>
    <div class="tick le"></div><div class="tick le2"></div>
    <div class="tick re"></div><div class="tick re2"></div>
    <div class="tick top"></div>
  </div>
  <div class="accent"></div>
  <div class="top">
    <div class="badge"><span class="d">◆</span> ${artist}</div>
    <div class="badgebar"><div class="segline"><i></i><i></i><i></i><i></i><i></i></div></div>
  </div>
  <div class="titwrap">
    <div class="rule"></div>
    <div class="title">${title}</div>
  </div>
  ${brandSvg ? `<div class="logo">${brandSvg}</div>` : ''}
  <script>
    document.fonts.ready.then(()=>{
      const title=document.querySelector('.title'), logo=document.querySelector('.logo');
      const total=SIZE;
      if(!title||!logo){ if(title&&!logo) title.style.fontSize='72px'; return; }
      const clearance=logo.getBoundingClientRect().left - 80;  // gap so title never touches logo
      const maxWidth=clearance - 52;  // preserve left padding
      const probe=title.cloneNode(true);
      probe.style.position='absolute'; probe.style.left='-9999px'; probe.style.top='-9999px';
      probe.style.removeProperty('background'); probe.style.webkitBackgroundClip='padding-box';
      document.body.appendChild(probe);
      let fs=72;
      probe.style.fontSize='72px'; probe.style.whiteSpace='nowrap';
      if (probe.getBoundingClientRect().width > maxWidth) {
        probe.style.whiteSpace='normal'; probe.style.width=maxWidth+'px';
        while (true) {
          probe.style.fontSize=fs+'px';
          const lineH=fs*0.98;
          const h=probe.getBoundingClientRect().height;
          const lines=Math.round(h/lineH);
          if (lines<=3 || fs<=12) break;
          fs-=2;
        }
        title.style.fontSize=fs+'px';
      }
      probe.remove();
    });
  </script>
</body></html>`
}

export async function renderHudCover({ baseImg, artist, title, out }) {
  const html = buildHtml({ baseImg, artist: artist.toUpperCase(), title })
  const dir = mkdtempSync(join(tmpdir(), 'hud-'))
  const htmlPath = join(dir, 'cover.html')
  writeFileSync(htmlPath, html)
  try {
    const ctx = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
    try {
      const page = await ctx.newPage()
      await page.setViewportSize({ width: SIZE, height: SIZE })
      await page.goto(`file://${htmlPath}`)
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(1200)
      await page.screenshot({ path: out, clip: { x: 0, y: 0, width: SIZE, height: SIZE } })
    } finally {
      await ctx.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , baseImg, artist, title, out] = process.argv
  if (!baseImg || !artist || !title || !out) {
    console.error('usage: node render-cover-hud.mjs <baseImg> <ARTIST> "<TITLE>" <out>')
    process.exit(1)
  }
  await renderHudCover({ baseImg, artist, title, out })
  console.log(`rendered -> ${out}`)
}
