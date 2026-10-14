/* Every source rectangle refers to the unmodified 1254 × 1254 atlas. */
(() => {
  "use strict";
  const definitions = {
    sky:        { rect: [43, 44, 155, 147] },
    grass:      { rect: [250, 46, 153, 144] },
    soil:       { rect: [442, 30, 171, 175] },
    cloud:      { rect: [627, 88, 165, 97] },
    hedge:      { rect: [804, 83, 428, 94] },
    wood:       { rect: [26, 218, 586, 113], cuts: [44, 44, 44, 44] },
    banner:     { rect: [612, 218, 617, 113], cuts: [44, 44, 44, 44] },
    cream:      { rect: [26, 341, 499, 231], cuts: [44, 44, 44, 44] },
    greenPanel: { rect: [529, 343, 347, 228], cuts: [29, 78, 29, 30] },
    pinkPanel:  { rect: [882, 343, 347, 228], cuts: [29, 78, 29, 30] },
    label:      { rect: [209, 863, 322, 76] },
    awning:     { rect: [557, 865, 504, 78] },
    itemSlot:   { rect: [32, 968, 123, 121], cuts: [25, 25, 25, 25] },
    countSlot:  { rect: [175, 1000, 118, 65], cuts: [18, 18, 18, 18] },
    arrow:      { rect: [310, 979, 111, 111] },
    paper:      { rect: [444, 961, 114, 146] },
    coin:       { rect: [580, 983, 110, 111] },
    carrot:     { rect: [699, 965, 125, 132] },
    apple:      { rect: [834, 970, 117, 123] },
    tomato:     { rect: [968, 974, 126, 120] },
    corn:       { rect: [1107, 972, 122, 124] },
    sunflower:  { rect: [57, 1095, 134, 144] },
    leaves:     { rect: [237, 1124, 92, 91] },
    flower:     { rect: [383, 1145, 77, 70] },
    tuft:       { rect: [492, 1132, 129, 84] },
    bush:       { rect: [662, 1102, 267, 127] },
    stump:      { rect: [1009, 1108, 179, 124] }
  };
  const sources = new Map();
  const slices = new Map();
  const stamps = new Map();
  const atlas = new Image();
  const ready = new Promise((resolve, reject) => {
    atlas.onload = () => resolve(atlas);
    atlas.onerror = reject;
  });
  atlas.src = "assets/atlas.png";

  function canvas(width, height) {
    const el = document.createElement("canvas");
    el.width = Math.max(1, Math.round(width));
    el.height = Math.max(1, Math.round(height));
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  function sprite(name, width, height, fit = "contain") {
    const source = sourceImage(name);
    const w = source.width, h = source.height;
    const el = canvas(width, height);
    el.className = "sprite";
    const ctx = el.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    if (fit === "stretch") {
      ctx.drawImage(source, 0, 0, el.width, el.height);
    } else {
      const scale = Math.min(el.width / w, el.height / h);
      const dw = w * scale, dh = h * scale;
      ctx.drawImage(source, (el.width-dw)/2, (el.height-dh)/2, dw, dh);
    }
    return el;
  }

  // Isolate pixels at native resolution before scaling. The sampler cannot
  // pick up a neighbour from the tightly packed atlas; no pixel readback is
  // required, so the page also works when opened directly through file://.
  function sourceImage(name) {
    if (!sources.has(name)) {
      const [x,y,w,h] = definitions[name].rect;
      const isolated = canvas(w,h);
      isolated.getContext("2d").drawImage(atlas,x,y,w,h,0,0,w,h);
      sources.set(name,isolated);
    }
    return sources.get(name);
  }

  function panelSlices(name) {
    if (!slices.has(name)) {
      const source = sourceImage(name);
      const [left,top,right,bottom] = definitions[name].cuts;
      const xs = [0,left,source.width-right,source.width];
      const ys = [0,top,source.height-bottom,source.height];
      const pieces = [];
      for (let row=0; row<3; row++) {
        for (let col=0; col<3; col++) {
          const w = xs[col+1]-xs[col], h = ys[row+1]-ys[row];
          const piece = canvas(w,h);
          piece.getContext("2d").drawImage(source,xs[col],ys[row],w,h,0,0,w,h);
          pieces.push(piece);
        }
      }
      slices.set(name,pieces);
    }
    return slices.get(name);
  }

  // Cut outside the corner ornaments, keeping whole screws in the corners.
  function panel(name, width, height) {
    const [left,top,right,bottom] = definitions[name].cuts;
    const el = canvas(width, height);
    width = el.width;
    height = el.height;
    el.className = "panel-skin";
    const ctx = el.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    const capScale = Math.min(1, width/(left+right), height/(top+bottom));
    const dx = [0, Math.round(left*capScale), width-Math.round(right*capScale), width];
    const dy = [0, Math.round(top*capScale), height-Math.round(bottom*capScale), height];
    const pieces = panelSlices(name);
    for (let row=0; row<3; row++) {
      for (let col=0; col<3; col++) {
        ctx.drawImage(pieces[row*3+col],dx[col],dy[row],dx[col+1]-dx[col],dy[row+1]-dy[row]);
      }
    }
    return el;
  }

  // Mirrored repeats make adjoining edges meet even though the supplied tiles
  // contain a decorative border; the atlas rectangle excludes that border.
  function textureStamp(name, tileSize) {
    const key = `${name}:${tileSize}`;
    if (stamps.has(key)) return stamps.get(key);
    const source = sourceImage(name);
    const stamp = canvas(tileSize*2, tileSize*2);
    const tileCtx = stamp.getContext("2d");
    for (let y=0; y<2; y++) {
      for (let x=0; x<2; x++) {
        tileCtx.save();
        tileCtx.translate(x ? tileSize*2 : 0, y ? tileSize*2 : 0);
        tileCtx.scale(x ? -1 : 1, y ? -1 : 1);
        tileCtx.drawImage(source,0,0,tileSize,tileSize);
        tileCtx.restore();
      }
    }
    stamps.set(key,stamp);
    return stamp;
  }

  function paintTexture(ctx,name,x,y,width,height,tileSize) {
    ctx.fillStyle = ctx.createPattern(textureStamp(name,tileSize),"repeat");
    ctx.fillRect(x,y,width,height);
  }

  function texture(name, width, height, tileSize) {
    const el = canvas(width,height);
    paintTexture(el.getContext("2d"),name,0,0,width,height,tileSize);
    return el;
  }

  function mount(root = document) {
    root.querySelectorAll("[data-panel]").forEach(el => {
      el.prepend(panel(el.dataset.panel,el.clientWidth,el.clientHeight));
    });
    root.querySelectorAll("[data-sprite]").forEach(el => {
      el.append(sprite(el.dataset.sprite,el.clientWidth,el.clientHeight,el.dataset.fit));
    });
  }

  window.FarmAssets = Object.freeze({ definitions, ready, sprite, panel, texture, paintTexture, mount });
})();
