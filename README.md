# 🐈 Mochi — 貓貓模擬器 (Cat Pet Simulation)

一隻完全由 **程序化生成（procedural）** 嘅貓：冇用任何外部 3D model、貼圖或者動畫檔。
貓嘅身體係用 SDF 雕出嚟再 marching-cubes 起網格，毛係 shell-fur 渲染，行路係 IK 步態，
而佢做咩事由一套 **needs + utility AI** 自己決定 —— 唔係播 animation clip，而係真係「諗」完先做。

跑喺 WebGL2 上面，Windows 11 + RTX 4070 可以開盡 **Ultra** preset。

---

## 快速開始（Windows 11）

```bash
# 需要 Node.js 20+ (https://nodejs.org)
npm install
npm run dev          # 開發模式 → http://localhost:5173
```

用 Chrome / Edge 開個網址就玩得。想要獨立 App 視窗：

```bash
npm i -D electron
npm run build
npm run desktop      # Electron 視窗，已經強制用獨顯
```

> **確保用到 4070**：Windows 設定 → 系統 → 顯示 → 顯示卡 → 揀 Chrome/Edge/Electron →
> 「圖形喜好設定」設成 **高效能**。喺 HUD 右下角可以睇到 fps 同三角形數。

### 畫質 preset

| Preset | 毛殼層數 | 身體體素 | 陰影 | 建議 |
|---|---|---|---|---|
| Low | 4 | 10.5 mm | 1024 | 內顯 / 筆電 |
| Medium | 10 | 8 mm | 2048 | GTX 16xx |
| High | 18 | 6.2 mm | 2048 | 預設 |
| **Ultra** | **28** | **5 mm** | **4096** | **RTX 4070**（~1.2M 三角形/幀，仍然 100+ fps） |

---

## 點玩

| 操作 | 功能 |
|---|---|
| 拖曳 / 滾輪 | 轉鏡頭、縮放 |
| **撳住貓再郁滑鼠** | 摸貓 → 佢會 purr、蹭你、trust 上升 |
| `F` / Feed | 加糧落碗 |
| `T` / Throw toy | 向滑鼠位置掟波（波有物理） |
| `L` / Laser | 開鐳射筆，光點跟住滑鼠，貓會潛行 → 撲 |
| `Space` / Call kitty | 叫佢過嚟（肯唔肯睬你要睇 trust 同心情）|
| `G` | 整出嚇親佢嘅聲（會炸毛、瞳孔放大、trust 跌）|

左上角 HUD 係佢七項生理需求；佢會自己去食嘢、飲水、瞓覺、剷沙、磨爪、
跳上窗台睇雀、玩波、舔毛、發癲（zoomies），冇嘢做就四圍行同坐低發呆。

---

## 真實感做咗啲乜

**外形**
- 身體 = 約 40 個 capsule 用 smooth-min 溝埋一齊嘅 SDF（有胸腔、腰位收腹、後腿臀肌、肩胛骨、
  面頰、口鼻、下巴），再用自寫嘅 indexed marching cubes 起面，法線用 SDF gradient 算（唔係面法線，所以好滑）。
- 自動蒙皮：對每條骨段做高斯權重 + 兩次拉普拉斯平滑。四肢骨用細 sigma，
  所以擺腳唔會扯到條肋骨（呢個係大部分自動蒙皮爛 mesh 嘅原因）。
- **Shell fur**：同一個 skinned mesh 畫 N 層，每層沿法線推出去 + 向後「梳」落去，
  fragment shader 用 hash 場逐條毛 alpha-cut，根部加暗做 AO，再加 sheen 做邊緣光。
- 毛色全部喺 shader 入面程序生成：mackerel tabby 條紋、尾環、腳襪、肚腩淺色、背脊深色 + fbm 雜色。
  4 款毛色可即時切換。
- 眼：瞳孔係真・垂直縫，虹膜有放射纖維，clearcoat 做角膜反光；瞳孔會隨興奮／光線放大收細。
  眼皮係兩塊半球殼，會眨眼、瞇眼、瞓覺閉埋。仲有鬍鬚、耳窩、鼻頭、脷（舔毛先出現）。

**動作**（全部係 procedural，冇 animation clip）
- 四肢 two-bone analytic IK + 尾段對準；前肘向後屈、後膝向前屈（正確貓解剖）。
- 三種步態：walk（LH-LF-RH-RF 序）、trot（對角）、gallop（前後對，脊椎跟住屈伸），
  duty factor、步幅、抬腳高度、身體上下起伏都跟速度變。
- 條尾係 verlet 物理鏈（8 節，有重力、阻尼、長度約束、地板碰撞），
  再由情緒去推佢嘅目標形狀（開心豎起、潛行拉平、嚇親炸起）。
- 19 個 key pose（sit / loaf / 側瞓 / 捲住瞓 / 潛行 / 撲 / 食 / 舔毛 / 伸懶腰 / 蹭 / 磨爪 / 拍嘢 / 炸毛…）
  連續混合，仲有呼吸、purr 震動、眨眼、耳仔抽動、頭部注視（有角度限制）。

**行為**
- 7 項需求（肚餓／口渴／精力／清潔／陪伴／玩／如廁）隨時間下降，每個行為按需求 + 性格打分，
  最高分嘅贏（有滯後避免猶豫不決），再行 goto → 執行嘅狀態機。
- 每隻貓出生就有隨機性格：playful / affection / bold / lazy，同埋一個會變嘅 **trust** 值。
- 反應式行為會蓋過一切：鐳射、俾人摸、被叫、波郁緊、受驚。
- 叫聲全部即時合成（Web Audio）：meow、chirp、hiss，purr 係 brown noise + 26 Hz 震幅調變。

**場景**：程序生成客廳（木地板／地毯／梳化／茶几／窗同陽光／貓竇／食水碗／貓爬架／貓砂盆／層架），
貓識得跳上梳化、窗台、茶几、牆架，亦識得跳返落嚟同繞開傢俬行。

---

## 專案結構

```
src/
  main.js              renderer / camera / input / 主迴圈
  audio.js             Web Audio 貓叫同 purr 合成
  lib/
    sdf.js             capsule SDF + smooth-min
    marchingCubes.js   indexed polygoniser（gradient 法線、自動修正 winding）
    mcTables.js        邊／三角查表
  cat/
    rig.js             35 條骨嘅骨架定義
    body.js            身體 SDF → mesh → 自動蒙皮
    fur.js             shell fur + 程序毛色 shader
    features.js        眼／耳／鼻／鬍鬚／脷
    poses.js           19 個 key pose
    anim.js            IK、步態、尾巴物理、面部
    cat.js             移動、轉向、跳躍、避障
  ai/brain.js          需求、效用評分、行為狀態機
  world/               房間、傢俬、物理（波）、鐳射、貼圖
  ui/hud.js            HUD
scripts/
  selftest.js          冇 GPU 都跑到嘅模擬層測試（npm run selftest）
  render.js            CPU 軟件渲染器，出 PNG 睇姿勢（node scripts/render.js sit out.png）
```

## 開發用指令

```bash
npm run dev        # dev server
npm run build      # 出 dist/
npm run selftest   # 幾何、蒙皮、IK、步態、AI soak test
node scripts/render.js trot preview.png 1.9 0.15    # 離線渲染某個 pose
```

## 之後可以加
- 第二隻貓同貓與貓之間嘅互動（互相理毛、搶位、打交）
- 掉毛／打結／梳毛、指甲、季節換毛
- 用 WebGPU compute 做真・毛髮 strand（而家係 shell 近似）
- 存檔（性格、trust、需求）同日／夜循環
