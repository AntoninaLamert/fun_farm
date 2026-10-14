(() => {
  "use strict";
  const A = window.FarmAssets;
  const economy = window.FarmEconomy;
  const DESIGN = Object.freeze({ width: 1490, height: 1055 });
  const FIELD = Object.freeze({ width: 1400, height: 340, bedSize: 60, originX: 8, originY: 23, columns: 23, rows: 5 });
  const workshopBounds = Object.freeze({x:1248,y:185,w:145,h:143});
  const designStoreBounds = Object.freeze({x:8,y:185,w:145,h:143});
  const viewportLayout = { width: 0, height: 0, scale: 1, x: 0, y: 0 };
  const decorations = [
    ["bush",-38,10,155,78], ["bush",-50,243,230,105],
    ["bush",1293,12,112,60], ["bush",1225,252,198,84],
    ["stump",113,188,84,61], ["stump",1102,67,84,61], ["stump",1135,269,84,61],
    ["flower",198,29,29,30], ["flower",411,43,28,29], ["flower",959,28,30,31],
    ["flower",35,137,28,29], ["flower",414,127,28,29], ["flower",258,223,30,31],
    ["flower",435,274,27,28], ["flower",898,235,28,29], ["flower",991,184,29,30],
    ["flower",1264,160,29,30], ["flower",1031,298,27,28]
  ];
  const tufts = [[132,18],[357,47],[478,10],[176,108],[299,127],[360,196],[484,239],
    [220,281],[864,26],[1019,81],[1156,14],[1292,92],[877,155],[1117,166],
    [985,252],[845,283],[1219,218],[45,203],[85,295]];
  const startingCells = [[10,1],[12,2],[11,3]];
  const SAVE_KEY = "veselaya-ferma-progress-v1";
  const startedAtMs = Date.now();
  const state = {
    coins: economy.initialCoins,
    inventory: Object.fromEntries(economy.products.map(id => [id,0])),
    demand: Object.fromEntries(economy.products.map(id => [id,0])),
    orders: [],
    beds: Array.from({length:economy.initialBeds}, (_,i) => {
      const [column,row] = startingCells[i];
      return {id:"bed-"+(i+1),column,row,x:FIELD.originX+column*FIELD.bedSize,
        y:FIELD.originY+row*FIELD.bedSize,crop:null,harvesting:false,
        paidPrice:economy.firstBedPrice};
    }),
    mode: null,
    selectedOrderId: null,
    boughtBeds: 0,
    completedOrders: 0,
    maxCoinsSeen: economy.initialCoins,
    deliveryInProgress: false,
    lastOrderAtMs: startedAtMs,
    orderTickAtMs: startedAtMs,
    soundEnabled: true,
    volume: 0.2,
    chicken: null,
    eggs: [],
    placedDecorations: [],
    nextEggAtMs: startedAtMs+economy.chicken.eggIntervalSeconds*1000,
    weatherEpochMs: startedAtMs
  };
  const byId = id => document.getElementById(id);
  const backgroundMusic = byId("background-music");
  backgroundMusic.volume = 0.2;
  const productById = id => economy.catalog.find(item => item.id === id);
  const sleep = seconds => new Promise(resolve => setTimeout(resolve,seconds*1000));
  const randomInt = (min,max) => min+Math.floor(Math.random()*(max-min+1));
  let sceneryReady = false;
  let musicUnlocked = false;
  let backgroundCanvas, terrainCanvas, hedgeSprite, cloudSprite, noticeTimer, nextOrderId = 1, audioContext;
  let suppressBedClickUntil = 0;
  let menuTarget = null;

  function syncBackgroundMusic() {
    backgroundMusic.volume = state.volume;
    if (!musicUnlocked) return;
    if (backgroundMusic.paused) {
      const playing = backgroundMusic.play();
      if (playing) playing.catch(() => {});
    }
  }

  function unlockBackgroundMusic() {
    if (musicUnlocked) return;
    musicUnlocked = true;
    syncBackgroundMusic();
  }

  function saveState() {
    const snapshot = {
      version:1,
      coins:state.coins,
      inventory:{...state.inventory},
      beds:state.beds.map(bed => ({
        id:bed.id,column:bed.column,row:bed.row,x:bed.x,y:bed.y,
        paidPrice:bed.paidPrice,
        crop:bed.crop ? {id:bed.crop.id,plantedAtMs:bed.crop.plantedAtMs} : null
      })),
      orders:state.orders.map(order => ({
        id:order.id,items:{...order.items},reward:order.reward,createdAtMs:order.createdAtMs
      })),
      boughtBeds:state.boughtBeds,
      completedOrders:state.completedOrders,
      maxCoinsSeen:state.maxCoinsSeen,
      lastOrderAtMs:state.lastOrderAtMs,
      orderTickAtMs:state.orderTickAtMs,
      soundEnabled:state.soundEnabled,
      volume:state.volume,
      chicken:state.chicken ? {...state.chicken} : null,
      eggs:state.eggs.map(egg => ({...egg})),
      placedDecorations:state.placedDecorations.map(item => ({...item})),
      nextEggAtMs:state.nextEggAtMs,
      weatherEpochMs:state.weatherEpochMs
    };
    try { localStorage.setItem(SAVE_KEY,JSON.stringify(snapshot)); } catch (_) { /* Хранилище может быть отключено. */ }
  }

  function restoreState() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (_) { return false; }
    if (!saved || saved.version!==1 || !Array.isArray(saved.beds) || !Array.isArray(saved.orders)) return false;
    const now = Date.now();
    const savedWeatherEpoch = Number(saved.weatherEpochMs);
    state.weatherEpochMs = Number.isFinite(savedWeatherEpoch) && savedWeatherEpoch>0
      ? savedWeatherEpoch : now;
    state.coins = Math.max(0,Number(saved.coins)||0);
    economy.products.forEach(id => { state.inventory[id] = Math.max(0,Number(saved.inventory?.[id])||0); });
    state.beds = saved.beds.map((bed,index) => {
      const crop = bed.crop && economy.products.includes(bed.crop.id) && Number.isFinite(Number(bed.crop.plantedAtMs))
        ? {id:bed.crop.id,plantedAtMs:Number(bed.crop.plantedAtMs)} : null;
      if (crop) crop.readyChimed = growthElapsedSeconds(crop.plantedAtMs,now)>=productById(crop.id).growSeconds;
      return {
        id:String(bed.id || "bed-"+(index+1)),column:Number(bed.column),row:Number(bed.row),
        x:Number(bed.x),y:Number(bed.y),crop,harvesting:false,
        paidPrice:Math.max(0,Number(bed.paidPrice ?? (index<economy.initialBeds
          ? economy.firstBedPrice : Math.min(economy.maxBedPrice,Math.round(
            economy.firstBedPrice*Math.pow(economy.bedPriceMultiplier,index-economy.initialBeds))))))
      };
    });
    state.orders = saved.orders.slice(0,economy.maxOrders).map((order,index) => ({
      id:Number(order.id)||index+1,
      items:Object.fromEntries(Object.entries(order.items || {}).filter(([id,count]) =>
        economy.products.includes(id) && Number(count)>0).map(([id,count]) => [id,Math.floor(Number(count))])),
      reward:Math.max(0,Number(order.reward)||0),
      createdAtMs:Number(order.createdAtMs)||now,
      status:"waiting"
    })).filter(order => Object.keys(order.items).length);
    state.boughtBeds = Math.max(0,Number(saved.boughtBeds)||0);
    state.completedOrders = Math.max(0,Number(saved.completedOrders)||0);
    state.maxCoinsSeen = Math.max(economy.initialCoins,Number(saved.maxCoinsSeen)||0);
    state.lastOrderAtMs = Number(saved.lastOrderAtMs)||now;
    state.orderTickAtMs = Number(saved.orderTickAtMs)||state.lastOrderAtMs;
    const savedVolume = saved.volume===undefined
      ? (saved.soundEnabled===false ? 0 : 0.2) : Number(saved.volume);
    state.volume = Number.isFinite(savedVolume) ? Math.min(1,Math.max(0,savedVolume)) : 0.2;
    state.soundEnabled = state.volume>0;
    backgroundMusic.volume = state.volume;
    state.chicken = saved.chicken && Number.isInteger(saved.chicken.column) && Number.isInteger(saved.chicken.row)
      ? {column:saved.chicken.column,row:saved.chicken.row} : null;
    state.eggs = Array.isArray(saved.eggs) ? saved.eggs.filter(egg =>
      Number.isInteger(egg.column) && Number.isInteger(egg.row) &&
      egg.column>=0 && egg.column<FIELD.columns && egg.row>=0 && egg.row<FIELD.rows
    ).slice(0,economy.chicken.maxEggs).map((egg,index) => ({id:String(egg.id || "egg-"+index),column:egg.column,row:egg.row})) : [];
    state.placedDecorations = Array.isArray(saved.placedDecorations) ? saved.placedDecorations.filter(item =>
      economy.designItems.some(design => design.id===item.type) &&
      Number.isInteger(item.column) && Number.isInteger(item.row) &&
      item.column>=0 && item.column<FIELD.columns && item.row>=0 && item.row<FIELD.rows
    ).map((item,index) => ({id:String(item.id || "decor-"+index),type:item.type,
      column:item.column,row:item.row,
      paidPrice:Math.max(0,Number(item.paidPrice ?? economy.designItems.find(design => design.id===item.type).price))})) : [];
    state.nextEggAtMs = Number(saved.nextEggAtMs) || now+economy.chicken.eggIntervalSeconds*1000;
    nextOrderId = Math.max(0,...state.orders.map(order => order.id))+1;
    return true;
  }

  function renderSoundToggle() {
    const button = byId("sound-toggle");
    const slider = byId("volume-slider");
    const percentage = Math.round(state.volume*100);
    button.classList.toggle("is-muted",percentage===0);
    button.setAttribute("aria-expanded",String(!byId("volume-control").hidden));
    button.setAttribute("aria-label","Настроить громкость");
    slider.value = String(percentage);
    byId("volume-value").textContent = percentage+"%";
  }

  function playSound(kind) {
    if (!state.soundEnabled) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      audioContext ||= new AudioContextClass();
      if (audioContext.state==="suspended") audioContext.resume().catch(() => {});
      const notes = {
        click:[[520,430,.055,0,.025]],
        buy:[[650,510,.13,0,.045],[780,640,.1,.08,.025]],
        plant:[[420,620,.16,0,.04]],
        ripe:[[560,820,.16,0,.035],[780,980,.18,.11,.03]],
        harvest:[[680,940,.18,0,.045]],
        order:[[650,820,.18,0,.035],[870,990,.15,.12,.025]],
        success:[[600,780,.15,0,.04],[800,1050,.22,.13,.04]],
        negative:[[390,310,.13,0,.04],[320,240,.16,.14,.035]]
      }[kind] || [];
      const origin = audioContext.currentTime;
      notes.forEach(([start,end,duration,delay,volume]) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const time = origin+delay;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(start,time);
        oscillator.frequency.exponentialRampToValueAtTime(end,time+duration);
        gain.gain.setValueAtTime(.0001,time);
        gain.gain.exponentialRampToValueAtTime(Math.min(1,volume*state.volume/0.2),time+.015);
        gain.gain.exponentialRampToValueAtTime(.0001,time+duration);
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(time);
        oscillator.stop(time+duration+.02);
      });
    } catch (_) { /* Звук не мешает игре, если аудио недоступно. */ }
  }

  function fitGame() {
    const viewport = document.querySelector(".viewport");
    const scale = Math.min(viewport.clientWidth/DESIGN.width,viewport.clientHeight/DESIGN.height);
    document.documentElement.style.setProperty("--game-scale",String(scale));
    Object.assign(viewportLayout,{
      width:viewport.clientWidth,height:viewport.clientHeight,scale,
      x:(viewport.clientWidth-DESIGN.width*scale)/2,
      y:(viewport.clientHeight-DESIGN.height*scale)/2
    });
    if (sceneryReady) renderScenery();
  }

  function imageSpan(sprite,className,width,height) {
    const el = document.createElement("span");
    el.className = className;
    el.setAttribute("aria-hidden","true");
    el.append(A.sprite(sprite,width,height));
    return el;
  }

  function connectActivation(button,eventName,detail) {
    let releaseTimer;
    button.addEventListener("click",() => {
      clearTimeout(releaseTimer);
      button.classList.add("is-pressed");
      releaseTimer = setTimeout(() => button.classList.remove("is-pressed"),160);
      playSound("click");
      window.FarmGame.events.dispatchEvent(new CustomEvent(eventName,{detail}));
    });
  }

  function pulseValue(element) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    element.animate([
      {transform:"translateY(0) scale(1)",filter:"brightness(1)"},
      {transform:"translateY(-5px) scale(1.2)",filter:"brightness(1.3)",offset:.45},
      {transform:"translateY(0) scale(1)",filter:"brightness(1)"}
    ],{duration:economy.animation.valuePulseSeconds*1000,easing:"ease-out"});
  }

  function bedPrice() {
    return Math.min(economy.maxBedPrice,
      Math.round(economy.firstBedPrice*Math.pow(economy.bedPriceMultiplier,state.boughtBeds)));
  }

  function productCard(product,value,section) {
    const isShop = section === "shop";
    const card = document.createElement("div");
    card.className = "product";
    card.dataset.product = product.id;
    card.dataset.section = section;
    const button = document.createElement("button");
    button.className = "produce-button";
    button.type = "button";
    const context = {shop:"Магазин",orders:"Нужно для заказов",warehouse:"На складе"}[section];
    button.setAttribute("aria-label",product.name+" — "+context+": "+value+(isShop?" монет":" шт."));
    if (isShop) button.setAttribute("aria-pressed","false");
    connectActivation(button,"product:activate",{productId:product.id,section});
    const picture = document.createElement("span");
    picture.className = "product-picture";
    const itemSkin = A.panel("itemSlot",90,83);
    itemSkin.className = "sprite slot-skin";
    button.append(imageSpan(product.sprite,"produce-icon",78,78));
    picture.append(itemSkin,button);
    const count = document.createElement("span");
    count.className = "product-count";
    const countSkin = A.panel("countSlot",90,43);
    countSkin.className = "sprite slot-skin";
    const output = document.createElement("output");
    output.dataset.product = product.id;
    output.textContent = String(value);
    output.setAttribute("aria-label",isShop?"Цена в монетах":"Количество");
    count.append(countSkin,output);
    card.append(picture,count);
    return card;
  }

  function renderShop() {
    byId("shop-products").replaceChildren(...economy.catalog.map(item =>
      productCard(item,item.id==="bed"?bedPrice():item.price,"shop")));
  }
  function renderInventory() {
    byId("warehouse-products").replaceChildren(...economy.products.map(id =>
      productCard(productById(id),state.inventory[id],"warehouse")));
    if (!byId("workshop-panel").hidden) renderWorkshop();
  }
  function renderDemand() {
    byId("demand-products").replaceChildren(...economy.products.map(id =>
      productCard(productById(id),state.demand[id],"orders")));
  }
  function updateCounter(section,id,value) {
    const card = document.querySelector('.product[data-section="'+section+'"][data-product="'+id+'"]');
    if (!card) return;
    const output = card.querySelector("output");
    const changed = output.textContent!==String(value);
    output.textContent = String(value);
    if (changed && section==="warehouse") pulseValue(output);
    const button = card.querySelector("button");
    button.setAttribute("aria-label",productById(id).name+" — "+
      ({shop:"Магазин",orders:"Нужно для заказов",warehouse:"На складе"}[section])+
      ": "+value+(section==="shop"?" монет":" шт."));
  }
  function updateInventory() {
    economy.products.forEach(id => updateCounter("warehouse",id,state.inventory[id]));
    if (!byId("workshop-panel").hidden) renderWorkshop();
  }
  function updateDemand() {
    economy.products.forEach(id => { state.demand[id] = 0; });
    state.orders.forEach(order => {
      Object.entries(order.items).forEach(([id,count]) => { state.demand[id] += count; });
    });
    economy.products.forEach(id => updateCounter("orders",id,state.demand[id]));
  }
  function renderCoins() {
    const output = byId("coins");
    const changed = output.textContent!==String(state.coins);
    output.textContent = String(state.coins);
    if (changed) pulseValue(output);
    if (!byId("design-panel").hidden) renderDesignStore();
  }
  function updateShopSelection() {
    document.querySelectorAll(".shop .product").forEach(card => {
      const selected = state.mode && card.dataset.product===state.mode.productId;
      card.classList.toggle("is-selected",!!selected);
      card.querySelector("button").setAttribute("aria-pressed",String(!!selected));
    });
    updateCounter("shop","bed",bedPrice());
  }

  function orderItems(parent,order) {
    Object.entries(order.items).forEach(([id,count]) => {
      const row = document.createElement("div");
      row.className = "order-item";
      row.append(A.sprite(productById(id).sprite,26,26));
      const value = document.createElement("b");
      value.textContent = "×"+count;
      row.append(value);
      parent.append(row);
    });
  }
  function renderOrderSlots() {
    const slots = Array.from({length:economy.maxOrders},(_,index) => {
      const el = document.createElement("li");
      el.className = "order-paper";
      el.dataset.orderSlot = String(index);
      el.setAttribute("aria-label","Место для заказа "+(index+1));
      el.append(A.sprite("paper",93,119));
      const content = document.createElement("div");
      content.className = "order-content";
      el.append(content);
      el.addEventListener("click",() => selectOrderAt(index));
      el.addEventListener("keydown",event => {
        if (event.key==="Enter" || event.key===" ") {
          event.preventDefault();
          selectOrderAt(index);
        }
      });
      return el;
    });
    byId("order-slots").replaceChildren(...slots);
  }
  function updateOrderSlots() {
    const slots = byId("order-slots").children;
    Array.from(slots).forEach((slot,index) => {
      const content = slot.querySelector(".order-content");
      const order = state.orders[index];
      content.replaceChildren();
      const selectable = !!order && order.status==="waiting";
      const selected = !!order && order.id===state.selectedOrderId;
      slot.classList.toggle("is-selectable",selectable);
      slot.classList.toggle("is-selected",selected);
      if (!order || order.status==="arriving") {
        slot.removeAttribute("tabindex");
        slot.removeAttribute("role");
        slot.removeAttribute("aria-pressed");
        slot.setAttribute("aria-label","Пустой лист заказа");
        return;
      }
      slot.tabIndex = selectable ? 0 : -1;
      slot.setAttribute("role","button");
      slot.setAttribute("aria-pressed",String(selected));
      orderItems(content,order);
      slot.setAttribute("aria-label",
        (selected?"Выбран. ":"")+"Заказ: "+Object.entries(order.items).map(([id,count]) => productById(id).name+" "+count).join(", ")+
        ". Награда: "+order.reward+" монет");
    });
  }
  function selectOrderAt(index) {
    const order = state.orders[index];
    if (!order || order.status!=="waiting" || state.deliveryInProgress) return;
    state.selectedOrderId = state.selectedOrderId===order.id ? null : order.id;
    playSound("click");
    updateOrderSlots();
  }

  function positionInField(el,x,y,width,height) {
    Object.assign(el.style,{
      left:(x/FIELD.width*100)+"%",top:(y/FIELD.height*100)+"%",
      width:(width/FIELD.width*100)+"%",height:(height/FIELD.height*100)+"%"
    });
  }
  function bedNode(bed) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bed";
    button.dataset.bedId = bed.id;
    positionInField(button,bed.x,bed.y,FIELD.bedSize,FIELD.bedSize);
    button.addEventListener("click",event => {
      if (Date.now()<suppressBedClickUntil) return;
      if (event.shiftKey || (!bed.crop && !state.mode)) {
        openItemMenu("bed",bed.id,event.clientX,event.clientY);
      } else onBedClicked(bed.id);
    });
    button.addEventListener("contextmenu",event => {
      event.preventDefault();
      openItemMenu("bed",bed.id,event.clientX,event.clientY);
    });
    button.addEventListener("keydown",event => {
      if (event.key==="ContextMenu" || (event.shiftKey && event.key==="F10")) {
        event.preventDefault();
        const rect = button.getBoundingClientRect();
        openItemMenu("bed",bed.id,rect.left+rect.width/2,rect.top+rect.height/2);
      }
    });
    drawBed(bed,button);
    return button;
  }
  function drawBed(bed,button = byId("beds").querySelector('[data-bed-id="'+bed.id+'"]'),animatePlant=false) {
    button.replaceChildren(imageSpan("soil","soil",120,120));
    button.classList.toggle("is-ready",false);
    if (bed.crop) {
      const plant = imageSpan(bed.crop.id,"plant",110,110);
      plant.style.setProperty("--plant-entry",economy.animation.plantAppearSeconds+"s");
      if (animatePlant) plant.classList.add("is-planting");
      button.append(plant);
      if (animatePlant) setTimeout(() => plant.classList.remove("is-planting"),economy.animation.plantAppearSeconds*1000);
    }
    updateBedGrowth(bed,button);
  }
  function renderBeds() {
    byId("beds").replaceChildren(...state.beds.map(bedNode));
  }
  function weatherAt(timeMs=Date.now()) {
    const phases = economy.weather;
    const cycleMs = phases.reduce((sum,phase) => sum+phase.durationSeconds*1000,0);
    let offset = Math.max(0,timeMs-state.weatherEpochMs)%cycleMs;
    for (const phase of phases) {
      const duration = phase.durationSeconds*1000;
      if (offset<duration) return phase;
      offset -= duration;
    }
    return phases[0];
  }
  function weightedWeatherMs(timeMs) {
    const phases = economy.weather;
    const cycleMs = phases.reduce((sum,phase) => sum+phase.durationSeconds*1000,0);
    const cycleGrowthMs = phases.reduce((sum,phase) =>
      sum+phase.durationSeconds*1000*phase.growthMultiplier,0);
    const elapsed = Math.max(0,timeMs-state.weatherEpochMs);
    let result = Math.floor(elapsed/cycleMs)*cycleGrowthMs;
    let remainder = elapsed%cycleMs;
    for (const phase of phases) {
      const portion = Math.min(remainder,phase.durationSeconds*1000);
      result += portion*phase.growthMultiplier;
      remainder -= portion;
      if (remainder<=0) break;
    }
    return result;
  }
  function growthElapsedSeconds(plantedAtMs,now=Date.now()) {
    const beforeWeather = Math.max(0,Math.min(now,state.weatherEpochMs)-plantedAtMs);
    const sinceWeather = now>state.weatherEpochMs
      ? weightedWeatherMs(now)-weightedWeatherMs(Math.max(plantedAtMs,state.weatherEpochMs)) : 0;
    return (beforeWeather+sinceWeather)/1000;
  }
  function secondsUntilRipe(crop,now=Date.now()) {
    const needed = productById(crop.id).growSeconds;
    if (growthElapsedSeconds(crop.plantedAtMs,now)>=needed) return 0;
    let low = now;
    let high = now+needed*2000;
    for (let i=0;i<18;i++) {
      const middle = (low+high)/2;
      if (growthElapsedSeconds(crop.plantedAtMs,middle)>=needed) high = middle;
      else low = middle;
    }
    return Math.ceil((high-now)/1000);
  }
  function updateWeather() {
    const weather = weatherAt();
    byId("weather-sky").dataset.weather = weather.id;
    byId("field-weather").dataset.weather = weather.id;
    byId("field").setAttribute("aria-label",{
      sun:"Солнечная погода",clouds:"Облачная погода: растения растут на 20% медленнее",
      rain:"Дождь: растения растут на 20% быстрее"
    }[weather.id]);
  }
  function updateBedGrowth(bed,button) {
    if (!button) return;
    if (!bed.crop) {
      button.setAttribute("aria-label","Свободная грядка");
      button.classList.remove("is-ready");
      return;
    }
    const product = productById(bed.crop.id);
    const elapsed = growthElapsedSeconds(bed.crop.plantedAtMs);
    const remaining = Math.max(0,product.growSeconds-elapsed);
    const progress = Math.min(1,elapsed/product.growSeconds);
    const plant = button.querySelector(".plant");
    if (plant) plant.style.setProperty("--growth-scale",String(.18+.82*progress));
    button.classList.toggle("is-ready",remaining===0);
    if (remaining===0 && !bed.crop.readyChimed) {
      bed.crop.readyChimed = true;
      playSound("ripe");
    }
    button.setAttribute("aria-label",product.name+" — "+(remaining===0?"можно собрать":"осталось "+secondsUntilRipe(bed.crop)+" с"));
  }
  function updateGrowth() {
    state.beds.forEach(bed => {
      if (bed.crop) updateBedGrowth(bed,byId("beds").querySelector('[data-bed-id="'+bed.id+'"]'));
    });
  }

  function boxesOverlap(a,b,pad=0) {
    return a.x < b.x+b.w+pad && a.x+a.w+pad > b.x &&
      a.y < b.y+b.h+pad && a.y+a.h+pad > b.y;
  }
  function cellPlaceable(column,row,ignoreChicken=false) {
    if (state.eggs.some(egg => egg.column===column && egg.row===row)) return false;
    if (!ignoreChicken && state.chicken?.column===column && state.chicken.row===row) return false;
    const x = FIELD.originX+column*FIELD.bedSize;
    const y = FIELD.originY+row*FIELD.bedSize;
    const cell = {x,y,w:FIELD.bedSize,h:FIELD.bedSize};
    if (boxesOverlap(cell,workshopBounds,2)) return false;
    if (boxesOverlap(cell,designStoreBounds,2)) return false;
    if (state.placedDecorations.some(item => item.column===column && item.row===row)) return false;
    if (state.beds.some(bed => boxesOverlap(cell,{x:bed.x,y:bed.y,w:FIELD.bedSize,h:FIELD.bedSize}))) return false;
    return true;
  }
  function positionStoreBuildings() {
    positionInField(byId("workshop-button"),workshopBounds.x,workshopBounds.y,
      workshopBounds.w,workshopBounds.h);
    positionInField(byId("design-store-button"),designStoreBounds.x,designStoreBounds.y,
      designStoreBounds.w,designStoreBounds.h);
  }
  function renderWorkshop() {
    const cards = economy.workshopRecipes.map(recipe => {
      const available = Object.entries(recipe.ingredients).every(([id,count]) => state.inventory[id]>=count);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "workshop-recipe";
      button.disabled = !available;
      button.setAttribute("aria-label",recipe.name+": "+Object.entries(recipe.ingredients)
        .map(([id,count]) => count+" "+productById(id).name).join(", ")+". Получить "+recipe.reward+" монет");
      const image = document.createElement("img");
      image.src = recipe.image;
      image.alt = "";
      image.draggable = false;
      const info = document.createElement("span");
      info.className = "workshop-recipe-info";
      const name = document.createElement("strong");
      name.className = "workshop-recipe-name";
      name.textContent = recipe.name;
      const ingredients = document.createElement("span");
      ingredients.className = "workshop-ingredients";
      Object.entries(recipe.ingredients).forEach(([id,count]) => {
        ingredients.append(A.sprite(productById(id).sprite,28,28));
        const amount = document.createElement("span");
        amount.textContent = count+" / "+state.inventory[id];
        ingredients.append(amount);
      });
      const reward = document.createElement("strong");
      reward.className = "workshop-reward";
      reward.textContent = "+"+recipe.reward+" монет";
      info.append(name,ingredients,reward);
      button.append(image,info);
      button.addEventListener("click",() => sellWorkshopRecipe(recipe));
      return button;
    });
    byId("workshop-recipes").replaceChildren(...cards);
  }
  function sellWorkshopRecipe(recipe) {
    if (!Object.entries(recipe.ingredients).every(([id,count]) => state.inventory[id]>=count)) return;
    Object.entries(recipe.ingredients).forEach(([id,count]) => { state.inventory[id] -= count; });
    state.coins += recipe.reward;
    state.maxCoinsSeen = Math.max(state.maxCoinsSeen,state.coins);
    saveState();
    updateInventory();
    renderCoins();
    bounceBalance();
    playSound("success");
  }
  function toggleWorkshop(open) {
    byId("workshop-panel").hidden = !open;
    byId("workshop-button").setAttribute("aria-expanded",String(open));
    if (open) {
      byId("design-panel").hidden = true;
      byId("design-store-button").setAttribute("aria-expanded","false");
    }
    if (open) renderWorkshop();
    playSound("click");
  }
  function renderDesignStore() {
    const cards = economy.designItems.map(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "design-item";
      button.disabled = state.coins<item.price;
      button.setAttribute("aria-label",item.name+" — "+item.price+" монет. Выбрать для размещения");
      button.setAttribute("aria-pressed",String(state.mode?.productId==="decor:"+item.id));
      const icon = item.sprite ? A.sprite(item.sprite,112,112) : document.createElement("img");
      if (item.image) { icon.src = item.image; icon.alt = ""; icon.draggable = false; }
      const info = document.createElement("span");
      info.className = "design-item-info";
      const name = document.createElement("strong");
      name.className = "design-item-name";
      name.textContent = item.name;
      const price = document.createElement("span");
      price.className = "design-item-price";
      price.textContent = item.price+" монет";
      const action = document.createElement("span");
      action.className = "design-item-action";
      action.textContent = "Купить и поставить";
      info.append(name,price,action);
      button.append(icon,info);
      button.addEventListener("click",() => {
        setMode("decor:"+item.id);
        toggleDesignStore(false);
      });
      return button;
    });
    byId("design-items").replaceChildren(...cards);
  }
  function toggleDesignStore(open) {
    byId("design-panel").hidden = !open;
    byId("design-store-button").setAttribute("aria-expanded",String(open));
    if (open) {
      byId("workshop-panel").hidden = true;
      byId("workshop-button").setAttribute("aria-expanded","false");
      renderDesignStore();
    }
    playSound("click");
  }
  function renderPlacedDecorations(newId=null) {
    const nodes = state.placedDecorations.map(item => {
      const design = economy.designItems.find(entry => entry.id===item.type);
      const el = document.createElement("span");
      el.className = "placed-decoration"+(item.id===newId ? " is-new" : "");
      el.setAttribute("role","button");
      el.tabIndex = 0;
      el.setAttribute("aria-label",design.name+" — управление украшением");
      el.dataset.decorationId = item.id;
      el.append(design.sprite ? A.sprite(design.sprite,52,52) : Object.assign(document.createElement("img"),{
        src:design.image,alt:"",draggable:false
      }));
      positionInField(el,FIELD.originX+item.column*FIELD.bedSize+4,
        FIELD.originY+item.row*FIELD.bedSize+4,52,52);
      el.addEventListener("click",event => openItemMenu("decor",item.id,event.clientX,event.clientY));
      el.addEventListener("contextmenu",event => {
        event.preventDefault();
        openItemMenu("decor",item.id,event.clientX,event.clientY);
      });
      el.addEventListener("keydown",event => {
        if (event.key==="Enter" || event.key===" " || event.key==="ContextMenu") {
          event.preventDefault();
          const rect = el.getBoundingClientRect();
          openItemMenu("decor",item.id,rect.left+rect.width/2,rect.top+rect.height/2);
        }
      });
      return el;
    });
    byId("player-decorations").replaceChildren(...nodes);
  }
  function buyDecoration(column,row) {
    const id = state.mode?.productId?.startsWith("decor:") ? state.mode.productId.slice(6) : null;
    const item = economy.designItems.find(entry => entry.id===id);
    if (!item || !cellPlaceable(column,row)) return;
    if (state.coins<item.price) { playSound("negative"); return; }
    state.coins -= item.price;
    const placed = {id:"decor-"+Date.now()+"-"+Math.random(),type:id,column,row,paidPrice:item.price};
    state.placedDecorations.push(placed);
    saveState();
    renderFieldDecorations();
    renderPlacedDecorations(placed.id);
    renderCoins();
    setMode(null);
    playSound("buy");
    maybeRescue();
  }
  function managedItem(kind,id) {
    return kind==="bed" ? state.beds.find(bed => bed.id===id) :
      state.placedDecorations.find(item => item.id===id);
  }
  function hideItemMenu() {
    byId("item-menu").hidden = true;
    menuTarget = null;
  }
  function openItemMenu(kind,id,clientX,clientY) {
    const item = managedItem(kind,id);
    if (!item || (kind==="bed" && item.harvesting)) return;
    if (state.mode) setMode(null);
    menuTarget = {kind,id};
    const name = kind==="bed" ? "Грядка" : economy.designItems.find(design => design.id===item.type).name;
    const refund = Math.floor(item.paidPrice*economy.resaleRate);
    byId("item-menu-heading").textContent = name;
    byId("item-menu-note").textContent = kind==="bed" && item.crop
      ? "При продаже или удалении растение пропадёт" : "";
    byId("item-menu-sell").textContent = "Продать (+"+refund+" монет)";
    const gameRect = byId("game").getBoundingClientRect();
    const menu = byId("item-menu");
    menu.style.left = Math.max(12,Math.min(DESIGN.width-250,
      (clientX-gameRect.left)/viewportLayout.scale+14))+"px";
    menu.style.top = Math.max(12,Math.min(DESIGN.height-220,
      (clientY-gameRect.top)/viewportLayout.scale+10))+"px";
    menu.hidden = false;
    playSound("click");
  }
  function startMovingItem() {
    if (!menuTarget || !managedItem(menuTarget.kind,menuTarget.id)) return;
    const {kind,id} = menuTarget;
    hideItemMenu();
    state.mode = {productId:"move:"+kind,itemId:id};
    updateShopSelection();
    renderPlacementGrid();
    playSound("click");
  }
  function moveManagedItem(column,row) {
    const mode = state.mode;
    if (!mode?.productId?.startsWith("move:") || !cellPlaceable(column,row)) return;
    const kind = mode.productId.slice(5);
    const item = managedItem(kind,mode.itemId);
    if (!item || (kind==="bed" && item.harvesting)) return;
    item.column = column;
    item.row = row;
    if (kind==="bed") {
      item.x = FIELD.originX+column*FIELD.bedSize;
      item.y = FIELD.originY+row*FIELD.bedSize;
      renderBeds();
    } else renderPlacedDecorations();
    renderFieldDecorations();
    saveState();
    setMode(null);
    playSound("buy");
  }
  function removeManagedItem(sell) {
    if (!menuTarget) return;
    const {kind,id} = menuTarget;
    const item = managedItem(kind,id);
    if (!item || (kind==="bed" && item.harvesting)) { hideItemMenu(); return; }
    if (sell) {
      state.coins += Math.floor(item.paidPrice*economy.resaleRate);
      state.maxCoinsSeen = Math.max(state.maxCoinsSeen,state.coins);
    }
    if (kind==="bed") {
      state.beds = state.beds.filter(bed => bed.id!==id);
      renderBeds();
    } else {
      state.placedDecorations = state.placedDecorations.filter(decor => decor.id!==id);
      renderPlacedDecorations();
    }
    hideItemMenu();
    renderFieldDecorations();
    renderPlacementGrid();
    saveState();
    if (sell) { renderCoins(); bounceBalance(); }
    playSound(sell ? "success" : "click");
    maybeRescue();
  }
  function freeChickenCells() {
    const cells = [];
    for (let row=0; row<FIELD.rows; row++) {
      for (let column=0; column<FIELD.columns; column++) {
        if (cellPlaceable(column,row,true)) cells.push({column,row});
      }
    }
    return cells;
  }
  function renderChicken() {
    const layer = byId("farm-chicken");
    if (!state.chicken) { layer.replaceChildren(); return; }
    let sprite = layer.firstElementChild;
    if (!sprite) {
      sprite = document.createElement("span");
      sprite.className = "chicken-sprite";
      sprite.style.transitionDuration = economy.chicken.stepSeconds*0.88+"s";
      const image = document.createElement("img");
      image.src = "assets/chicken.png";
      image.alt = "";
      image.draggable = false;
      sprite.append(image);
      layer.append(sprite);
    }
    positionInField(sprite,FIELD.originX+state.chicken.column*FIELD.bedSize,
      FIELD.originY+state.chicken.row*FIELD.bedSize,FIELD.bedSize,FIELD.bedSize);
  }
  function moveChicken() {
    if (!state.chicken) return;
    const {column,row} = state.chicken;
    const neighbours = [[1,0],[-1,0],[0,1],[0,-1]]
      .map(([dx,dy]) => ({column:column+dx,row:row+dy}))
      .filter(cell => cell.column>=0 && cell.column<FIELD.columns && cell.row>=0 && cell.row<FIELD.rows &&
        cellPlaceable(cell.column,cell.row,true));
    if (!neighbours.length) return;
    const next = neighbours[randomInt(0,neighbours.length-1)];
    byId("farm-chicken").firstElementChild?.classList.toggle("is-facing-left",next.column<column);
    state.chicken = next;
    renderChicken();
    if (state.mode?.productId==="bed" || state.mode?.productId?.startsWith("decor:") ||
      state.mode?.productId?.startsWith("move:")) renderPlacementGrid();
  }
  function renderEggs() {
    const layer = byId("farm-eggs");
    layer.replaceChildren(...state.eggs.map(egg => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "farm-egg";
      button.setAttribute("aria-label","Собрать яйцо: +"+economy.chicken.eggRewardCoins+" монет");
      const image = document.createElement("img");
      image.src = "assets/egg.png";
      image.alt = "";
      image.draggable = false;
      button.append(image);
      positionInField(button,FIELD.originX+egg.column*FIELD.bedSize+11,
        FIELD.originY+egg.row*FIELD.bedSize+7,38,46);
      button.addEventListener("click",() => collectEgg(egg,button));
      return button;
    }));
  }
  async function collectEgg(egg,button) {
    if (!state.eggs.some(item => item.id===egg.id)) return;
    const flight = flySprite("coin",button,document.querySelector(".balance-panel .coin"),
      economy.animation.coinFlightSeconds);
    state.eggs = state.eggs.filter(item => item.id!==egg.id);
    state.coins += economy.chicken.eggRewardCoins;
    state.maxCoinsSeen = Math.max(state.maxCoinsSeen,state.coins);
    button.remove();
    renderPlacementGrid();
    saveState();
    playSound("harvest");
    await flight;
    renderCoins();
    bounceBalance();
  }
  function produceEggs() {
    const intervalMs = economy.chicken.eggIntervalSeconds*1000;
    const due = Math.floor(Math.max(0,Date.now()-state.nextEggAtMs)/intervalMs)+1;
    if (Date.now()<state.nextEggAtMs) return;
    const room = economy.chicken.maxEggs-state.eggs.length;
    for (let index=0; index<Math.min(due,room); index++) {
      const choices = freeChickenCells();
      const cell = index===0 && state.chicken && choices.some(item =>
        item.column===state.chicken.column && item.row===state.chicken.row)
        ? state.chicken : choices[randomInt(0,choices.length-1)];
      if (!cell) break;
      state.eggs.push({id:"egg-"+Date.now()+"-"+index,column:cell.column,row:cell.row});
    }
    state.nextEggAtMs += due*intervalMs;
    renderEggs();
    renderPlacementGrid();
    saveState();
    if (room>0 && document.visibilityState==="visible") playSound("order");
  }
  function renderPlacementGrid() {
    const grid = byId("placement-grid");
    grid.replaceChildren();
    const buying = !!state.mode && state.mode.productId==="bed";
    const decorating = !!state.mode?.productId?.startsWith("decor:");
    const moving = !!state.mode?.productId?.startsWith("move:");
    document.querySelectorAll(".bed, .placed-decoration").forEach(el => {
      el.classList.toggle("is-moving-source",moving &&
        (el.dataset.bedId===state.mode.itemId || el.dataset.decorationId===state.mode.itemId));
    });
    byId("field").classList.toggle("is-buying-land",buying || decorating || moving);
    if (!buying && !decorating && !moving) return;
    for (let row=0; row<FIELD.rows; row++) {
      for (let column=0; column<FIELD.columns; column++) {
        if (!cellPlaceable(column,row)) continue;
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "placement-cell"+(decorating || moving ? " is-decoration" : "");
        cell.setAttribute("aria-label",moving ? "Переставить сюда" :
          decorating ? "Поставить украшение в этом месте" : "Купить грядку в этом месте");
        positionInField(cell,FIELD.originX+column*FIELD.bedSize,
          FIELD.originY+row*FIELD.bedSize,FIELD.bedSize,FIELD.bedSize);
        cell.addEventListener("click",() => moving ? moveManagedItem(column,row) :
          decorating ? buyDecoration(column,row) : buyBed(column,row));
        grid.append(cell);
      }
    }
  }
  function setMode(productId) {
    if (!byId("item-menu").hidden) hideItemMenu();
    state.mode = state.mode && state.mode.productId===productId ? null : productId ? {productId} : null;
    updateShopSelection();
    renderPlacementGrid();
    if (!byId("design-panel").hidden) renderDesignStore();
  }
  function buyBed(column,row) {
    playSound("click");
    if (!state.mode || state.mode.productId!=="bed" || !cellPlaceable(column,row)) return;
    const price = bedPrice();
    if (state.coins<price) { playSound("negative"); return; }
    state.coins -= price;
    state.boughtBeds++;
    const bed = {
      id:"bed-"+Date.now()+"-"+Math.random().toString(36).slice(2,8),column,row,
      x:FIELD.originX+column*FIELD.bedSize,y:FIELD.originY+row*FIELD.bedSize,
      crop:null,harvesting:false,paidPrice:price
    };
    state.beds.push(bed);
    saveState();
    renderFieldDecorations();
    const node = bedNode(bed);
    node.classList.add("is-new");
    node.style.setProperty("--bed-entry",economy.animation.bedAppearSeconds+"s");
    byId("beds").append(node);
    setTimeout(() => node.classList.remove("is-new"),economy.animation.bedAppearSeconds*1000);
    renderCoins();
    setMode(null);
    playSound("buy");
    maybeRescue();
  }

  async function onBedClicked(id,fromDrag=false) {
    if (!fromDrag && Date.now()<suppressBedClickUntil) return;
    const bed = state.beds.find(item => item.id===id);
    if (!fromDrag) playSound("click");
    if (!bed || bed.harvesting || (state.mode &&
      (state.mode.productId==="bed" || state.mode.productId.startsWith("move:")))) return;
    if (bed.crop) {
      const product = productById(bed.crop.id);
      const remaining = Math.max(0,product.growSeconds-growthElapsedSeconds(bed.crop.plantedAtMs));
      if (remaining===0) await harvest(bed);
      else notice(product.name+" — осталось "+secondsUntilRipe(bed.crop)+" с");
      return;
    }
    if (!state.mode || state.mode.productId.startsWith("decor:")) return;
    const product = productById(state.mode.productId);
    if (state.coins<product.price) { playSound("negative"); return; }
    state.coins -= product.price;
    bed.crop = {id:product.id,plantedAtMs:Date.now(),readyChimed:false};
    saveState();
    renderCoins();
    drawBed(bed,undefined,true);
    playSound("buy");
    setTimeout(() => playSound("plant"),90);
    maybeRescue();
  }

  function elementCenter(el) {
    const a = el.getBoundingClientRect();
    const game = byId("game").getBoundingClientRect();
    return {x:(a.left+a.width/2-game.left)/viewportLayout.scale,
      y:(a.top+a.height/2-game.top)/viewportLayout.scale};
  }
  function animateElement(el,keyframes,seconds,easing="ease-in-out") {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
    const animation = el.animate(keyframes,{duration:seconds*1000,easing,fill:"forwards"});
    return animation.finished.then(() => animation.cancel()).catch(() => {});
  }
  async function flySprite(name,fromEl,toEl,seconds,delaySeconds=0) {
    if (delaySeconds) await sleep(delaySeconds);
    const from = elementCenter(fromEl);
    const to = elementCenter(toEl);
    const flyer = imageSpan(name,"flying-product",64,64);
    flyer.style.left = (from.x-32)+"px";
    flyer.style.top = (from.y-32)+"px";
    byId("animation-layer").append(flyer);
    await animateElement(flyer,[
      {transform:"translate(0px,0px) scale(1)",opacity:1},
      {transform:"translate("+((to.x-from.x)*.5)+"px,"+((to.y-from.y)*.35-65)+"px) scale(1.1)",opacity:1,offset:.5},
      {transform:"translate("+(to.x-from.x)+"px,"+(to.y-from.y)+"px) scale(.45)",opacity:.95}
    ],seconds,"cubic-bezier(.22,.65,.28,1)");
    flyer.remove();
  }
  function reactArrow(success) {
    const arrow = document.querySelector(".delivery-button");
    const frames = success ? [
      {transform:"translateY(0)"},
      {transform:"translateY(-17px)",offset:.24},
      {transform:"translateY(0)",offset:.49},
      {transform:"translateY(-9px)",offset:.73},
      {transform:"translateY(0)"}
    ] : [
      {transform:"translateX(0)"},
      {transform:"translateX(-10px)",offset:.15},
      {transform:"translateX(10px)",offset:.32},
      {transform:"translateX(-8px)",offset:.49},
      {transform:"translateX(8px)",offset:.66},
      {transform:"translateX(-4px)",offset:.83},
      {transform:"translateX(0)"}
    ];
    animateElement(arrow,frames,economy.animation.arrowReactionSeconds,"ease-in-out");
  }
  function bounceBalance() {
    const coin = document.querySelector(".balance-panel .coin");
    animateElement(coin,[
      {transform:"translateY(0) scale(1)"},
      {transform:"translateY(-10px) scale(1.12)",offset:.45},
      {transform:"translateY(0) scale(1)"}
    ],economy.animation.valuePulseSeconds,"ease-out");
  }
  async function harvest(bed) {
    const source = byId("beds").querySelector('[data-bed-id="'+bed.id+'"] .plant');
    const target = document.querySelector('.product[data-section="warehouse"][data-product="'+bed.crop.id+'"] .produce-button');
    const id = bed.crop.id;
    bed.harvesting = true;
    const flight = flySprite(productById(id).sprite,source,target,economy.animation.harvestFlightSeconds);
    bed.crop = null;
    state.inventory[id]++;
    saveState();
    drawBed(bed);
    playSound("harvest");
    await flight;
    updateInventory();
    bed.harvesting = false;
    maybeRescue();
  }

  function setupDragFieldActions() {
    const field = byId("field");
    let pointerId = null;
    let start = null;
    let previous = null;
    let plantedDuringDrag = false;
    let insufficientSignaled = false;
    const actAt = (x,y) => {
      if (state.mode?.productId?.startsWith("move:")) return;
      const target = document.elementFromPoint(x,y);
      const button = target?.closest?.(".bed");
      if (!button || !field.contains(button)) return;
      const bed = state.beds.find(item => item.id===button.dataset.bedId);
      if (!bed || bed.harvesting) return;
      if (bed.crop) {
        const product = productById(bed.crop.id);
        if (growthElapsedSeconds(bed.crop.plantedAtMs)>=product.growSeconds) harvest(bed);
        return;
      }
      const selected = state.mode?.productId;
      if (!selected || selected==="bed" || selected.startsWith("decor:") || selected.startsWith("move:")) return;
      const product = productById(selected);
      if (state.coins<product.price) {
        if (!insufficientSignaled) { playSound("negative"); insufficientSignaled = true; }
        return;
      }
      onBedClicked(bed.id,true);
      plantedDuringDrag = true;
    };
    const sweepTo = (x,y) => {
      if (!previous) return;
      const distance = Math.hypot(x-previous.x,y-previous.y);
      const step = Math.max(8,FIELD.bedSize*viewportLayout.scale/3);
      const samples = Math.max(1,Math.ceil(distance/step));
      for (let index=1; index<=samples; index++) {
        const part = index/samples;
        actAt(previous.x+(x-previous.x)*part,previous.y+(y-previous.y)*part);
      }
      previous = {x,y};
      if (Math.hypot(x-start.x,y-start.y)>8) suppressBedClickUntil = Date.now()+120;
    };
    field.addEventListener("pointerdown",event => {
      if (event.pointerType!=="mouse" || event.button!==0 || event.shiftKey) return;
      pointerId = event.pointerId;
      start = previous = {x:event.clientX,y:event.clientY};
      plantedDuringDrag = false;
      insufficientSignaled = false;
      actAt(event.clientX,event.clientY);
    });
    document.addEventListener("pointermove",event => {
      if (event.pointerId!==pointerId) return;
      if (!(event.buttons&1)) { pointerId = null; return; }
      sweepTo(event.clientX,event.clientY);
    });
    document.addEventListener("pointerup",event => {
      if (event.pointerId!==pointerId) return;
      sweepTo(event.clientX,event.clientY);
      if (plantedDuringDrag || insufficientSignaled) suppressBedClickUntil = Date.now()+120;
      pointerId = null;
    });
    document.addEventListener("pointercancel",event => {
      if (event.pointerId===pointerId) pointerId = null;
    });
    window.addEventListener("blur",() => { pointerId = null; });
    field.addEventListener("dragstart",event => event.preventDefault());
  }

  function notice(message) {
    const el = byId("game-message");
    clearTimeout(noticeTimer);
    el.textContent = message;
    el.classList.add("is-visible");
    noticeTimer = setTimeout(() => {
      el.classList.remove("is-visible");
      el.textContent = "";
    },economy.noticeSeconds*1000);
  }
  function canFulfil(order,inventory) {
    return Object.entries(order.items).every(([id,count]) => inventory[id]>=count);
  }
  function maybeRescue() {
    const cheapest = productById(economy.rescueSeedId);
    if (state.deliveryInProgress) return;
    if (state.coins>=cheapest.price) return;
    if (!state.beds.some(bed => !bed.crop && !bed.harvesting)) return;
    if (state.beds.some(bed => bed.crop)) return;
    if (state.orders.some(order => order.status==="waiting" && canFulfil(order,state.inventory))) return;
    state.coins = cheapest.price;
    saveState();
    renderCoins();
  }

  function difficulty() {
    return [...economy.orderDifficulty].reverse().find(level => state.completedOrders>=level.afterCompleted);
  }
  function createOrderItems() {
    const level = difficulty();
    const available = economy.products.filter(id => {
      const product = productById(id);
      return state.completedOrders>=product.unlockAfterOrders && state.maxCoinsSeen>=product.price;
    });
    const mixed = available.sort(() => Math.random()-.5);
    const maxKinds = Math.min(level.maxKinds,mixed.length);
    const minKinds = Math.min(level.minKinds,maxKinds);
    const chosen = mixed.slice(0,randomInt(minKinds,maxKinds));
    const items = Object.fromEntries(chosen.map(id => [id,1]));
    const maxTotal = Math.min(level.maxUnits,chosen.length*level.maxPerKind);
    const total = randomInt(Math.max(level.minUnits,chosen.length),maxTotal);
    let current = chosen.length;
    while (current<total) {
      const choices = chosen.filter(id => items[id]<level.maxPerKind);
      const id = choices[randomInt(0,choices.length-1)];
      items[id]++;
      current++;
    }
    return items;
  }
  function rewardFor(items) {
    const base = Object.entries(items).reduce((sum,[id,count]) =>
      sum+productById(id).baseValue*count,0);
    return Math.round(base*economy.rewardMultiplier);
  }
  function addOrder(first=false,{instant=false,createdAtMs=Date.now()}={}) {
    if (state.orders.length>=economy.maxOrders) return;
    const items = first ? {...economy.firstOrder} : createOrderItems();
    const order = {id:nextOrderId++,items,reward:rewardFor(items),createdAtMs,
      status:instant?"waiting":"arriving"};
    state.orders.push(order);
    state.lastOrderAtMs = createdAtMs;
    updateDemand();
    updateOrderSlots();
    saveState();
    if (!instant) {
      playSound("order");
      animateNewOrder(order);
    }
  }
  function processDueOrders(animateCurrent) {
    const intervalMs = economy.orderIntervalSeconds*1000;
    const due = Math.floor(Math.max(0,Date.now()-state.orderTickAtMs)/intervalMs);
    if (!due) return;
    const room = economy.maxOrders-state.orders.length;
    const firstAt = state.orderTickAtMs+intervalMs;
    for (let index=0; index<Math.min(due,room); index++) {
      addOrder(false,{
        instant:!(animateCurrent && due===1 && document.visibilityState==="visible"),
        createdAtMs:firstAt+index*intervalMs
      });
    }
    state.orderTickAtMs += due*intervalMs;
    saveState();
  }
  function scheduleNextOrder() {
    const remaining = state.orderTickAtMs+economy.orderIntervalSeconds*1000-Date.now();
    setTimeout(() => {
      processDueOrders(true);
      scheduleNextOrder();
    },Math.max(100,remaining));
  }
  function createOrderFlyer(order) {
    const flyer = document.createElement("div");
    flyer.className = "order-flyer";
    flyer.append(A.sprite("paper",190,242));
    const content = document.createElement("div");
    content.className = "order-flyer-content";
    orderItems(content,order);
    const reward = document.createElement("b");
    reward.className = "order-flyer-reward";
    reward.textContent = "+"+order.reward+" монет";
    content.append(reward);
    flyer.append(content);
    return flyer;
  }
  async function animateNewOrder(order) {
    const flyer = createOrderFlyer(order);
    const startX = 650, startY = 138;
    flyer.style.left = startX+"px";
    flyer.style.top = startY+"px";
    byId("animation-layer").append(flyer);
    await animateElement(flyer,[
      {transform:"translateY(-410px) scale(.78)",opacity:0},
      {transform:"translateY(0px) scale(1)",opacity:1}
    ],economy.animation.orderEntrySeconds,"cubic-bezier(.2,.8,.2,1)");
    await sleep(economy.animation.orderCardHoldSeconds);
    const index = state.orders.indexOf(order);
    if (index<0) { flyer.remove(); return; }
    const destination = byId("order-slots").children[index];
    const target = elementCenter(destination);
    const from = elementCenter(flyer);
    await animateElement(flyer,[
      {transform:"translate(0px,0px) scale(1)",opacity:1},
      {transform:"translate("+(target.x-from.x)+"px,"+(target.y-from.y)+"px) scale(.49)",opacity:1}
    ],economy.animation.orderDockSeconds,"cubic-bezier(.3,.1,.2,1)");
    flyer.remove();
    order.status = "waiting";
    updateOrderSlots();
  }
  async function deliverOrders(automatic=false) {
    if (state.deliveryInProgress) return;
    const targetIds = automatic
      ? state.orders.filter(order => order.status==="waiting").map(order => order.id)
      : [state.selectedOrderId];
    const available = targetIds.some(id => {
      const order = state.orders.find(item => item.id===id);
      return order?.status==="waiting" && canFulfil(order,state.inventory);
    });
    if (!available) {
      reactArrow(false);
      playSound("negative");
      return;
    }
    state.deliveryInProgress = true;
    reactArrow(true);
    playSound("success");
    try {
      for (const id of targetIds) {
        const order = state.orders.find(item => item.id===id);
        if (!order || order.status!=="waiting" || !canFulfil(order,state.inventory)) continue;
        order.status = "delivering";
        const slot = byId("order-slots").children[state.orders.indexOf(order)];
        const flights = Object.keys(order.items).map(id => {
          const source = document.querySelector('.product[data-section="warehouse"][data-product="'+id+'"] .produce-button');
          return flySprite(productById(id).sprite,source,slot,economy.animation.deliveryFlightSeconds);
        });
        await Promise.all(flights);
        const coinTarget = document.querySelector(".balance-panel .coin");
        await Promise.all([0,1,2].map(index => flySprite("coin",slot,coinTarget,
          economy.animation.coinFlightSeconds,index*economy.animation.coinStaggerSeconds)));
        Object.entries(order.items).forEach(([id,count]) => { state.inventory[id]-=count; });
        state.coins += order.reward;
        state.maxCoinsSeen = Math.max(state.maxCoinsSeen,state.coins);
        state.completedOrders++;
        state.orders.splice(state.orders.indexOf(order),1);
        state.selectedOrderId = null;
        saveState();
        updateInventory();
        renderCoins();
        bounceBalance();
        await animateElement(slot,[
          {transform:"scale(1)",opacity:1},
          {transform:"translateY(-18px) scale(.5)",opacity:0}
        ],economy.animation.orderExitSeconds);
        updateDemand();
        updateOrderSlots();
      }
    } finally {
      state.deliveryInProgress = false;
      maybeRescue();
    }
  }

  function renderScenery() {
    const {width,height,scale,x:offsetX,y:offsetY} = viewportLayout;
    if (!width || !height || !scale) return;
    const ratio = Math.min(window.devicePixelRatio || 1,2);
    if (!backgroundCanvas) {
      backgroundCanvas = document.createElement("canvas");
      terrainCanvas = document.createElement("canvas");
      byId("scenery").replaceChildren(backgroundCanvas);
      hedgeSprite = A.sprite("hedge",600,180);
      cloudSprite = A.sprite("cloud",260,135);
    }
    backgroundCanvas.width = terrainCanvas.width = Math.ceil(width*ratio);
    backgroundCanvas.height = terrainCanvas.height = Math.ceil(height*ratio);
    const ctx = backgroundCanvas.getContext("2d");
    const ground = terrainCanvas.getContext("2d");
    const transform = [ratio*scale,0,0,ratio*scale,ratio*offsetX,ratio*offsetY];
    ctx.setTransform(...transform);
    ground.setTransform(...transform);
    const left = -offsetX/scale, top = -offsetY/scale;
    const sceneWidth = width/scale, sceneHeight = height/scale;
    A.paintTexture(ctx,"sky",left,top,sceneWidth,sceneHeight,470);
    ctx.globalAlpha = .6;
    for (let x=Math.floor(left/460)*460-460; x<left+sceneWidth; x+=460) {
      ctx.drawImage(cloudSprite,x+50,-45);
      ctx.drawImage(hedgeSprite,x-70,280);
    }
    ctx.globalAlpha = 1;
    A.paintTexture(ground,"grass",left,top,sceneWidth,sceneHeight,240);
    ground.globalCompositeOperation = "destination-in";
    const horizon = ground.createLinearGradient(0,400,0,565);
    horizon.addColorStop(0,"rgba(0,0,0,0)");
    horizon.addColorStop(1,"rgba(0,0,0,1)");
    ground.fillStyle = horizon;
    ground.fillRect(left,top,sceneWidth,sceneHeight);
    ground.globalCompositeOperation = "source-over";
    ctx.setTransform(1,0,0,1,0,0);
    ctx.drawImage(terrainCanvas,0,0);
  }
  function renderFieldDecorations() {
    const field = byId("field");
    const surface = byId("field-grass");
    surface.width = field.clientWidth;
    surface.height = field.clientHeight;
    const ctx = surface.getContext("2d");
    const worldX = field.offsetLeft+field.parentElement.offsetLeft;
    const worldY = field.offsetTop+field.parentElement.offsetTop;
    ctx.translate(-worldX,-worldY);
    A.paintTexture(ctx,"grass",worldX,worldY,surface.width,surface.height,240);
    const occupied = [
      ...state.beds.map(bed => ({x:bed.x,y:bed.y,w:FIELD.bedSize,h:FIELD.bedSize})),
      ...state.placedDecorations.map(item => ({
        x:FIELD.originX+item.column*FIELD.bedSize,
        y:FIELD.originY+item.row*FIELD.bedSize,
        w:FIELD.bedSize,h:FIELD.bedSize
      }))
    ];
    const art = [...decorations,...tufts.map(([x,y]) => ["tuft",x,y,51,29])]
      .filter(([,x,y,w,h]) => !occupied.some(cell => boxesOverlap({x,y,w,h},cell)));
    const nodes = art.map(([name,x,y,w,h]) => {
      const el = imageSpan(name,"field-decoration decoration-"+name,w*2,h*2);
      positionInField(el,x,y,w,h);
      if (name==="tuft") el.style.opacity = ".35";
      return el;
    });
    byId("field-decorations").replaceChildren(...nodes);
  }

  window.FarmGame = {
    state,economy,assets:A,events:new EventTarget(),
    field:{
      ...FIELD,
      clientToLogical(clientX,clientY) {
        const rect = byId("field").getBoundingClientRect();
        return {x:(clientX-rect.left)/rect.width*FIELD.width,
          y:(clientY-rect.top)/rect.height*FIELD.height};
      },
      positionElement:positionInField
    },
    view:{renderCoins,renderShop,renderInventory,renderDemand,renderOrderSlots,renderBeds}
  };

  const resumed = restoreState();
  positionStoreBuildings();
  document.addEventListener("pointerdown",unlockBackgroundMusic,{capture:true,once:true});
  document.addEventListener("keydown",unlockBackgroundMusic,{capture:true,once:true});
  document.addEventListener("click",unlockBackgroundMusic,{capture:true,once:true});
  fitGame();
  window.addEventListener("resize",fitGame);
  document.addEventListener("keydown",event => {
    if (event.key==="Escape") {
      if (!byId("item-menu").hidden) hideItemMenu();
      if (state.mode) setMode(null);
      if (!byId("workshop-panel").hidden) toggleWorkshop(false);
      if (!byId("design-panel").hidden) toggleDesignStore(false);
      if (!byId("volume-control").hidden) {
        byId("volume-control").hidden = true;
        renderSoundToggle();
      }
    }
  });
  window.FarmGame.events.addEventListener("product:activate",event => {
    if (event.detail.section==="shop") setMode(event.detail.productId);
  });
  const deliveryButton = document.querySelector(".delivery-button");
  let deliveryClickTimer;
  deliveryButton.addEventListener("click",event => {
    clearTimeout(deliveryClickTimer);
    deliveryButton.classList.add("is-pressed");
    setTimeout(() => deliveryButton.classList.remove("is-pressed"),160);
    playSound("click");
    if (event.detail>=2) deliverOrders(true);
    else if (event.detail===0) deliverOrders();
    else deliveryClickTimer = setTimeout(() => deliverOrders(),500);
  });
  A.ready.then(() => {
    A.mount();
    sceneryReady = true;
    renderScenery();
    renderShop();
    renderInventory();
    renderDemand();
    renderOrderSlots();
    renderCoins();
    renderFieldDecorations();
    renderBeds();
    updateWeather();
    setupDragFieldActions();
    renderPlacedDecorations();
    state.eggs.forEach(egg => {
      const eggCell = {x:FIELD.originX+egg.column*FIELD.bedSize,
        y:FIELD.originY+egg.row*FIELD.bedSize,w:FIELD.bedSize,h:FIELD.bedSize};
      if (boxesOverlap(eggCell,workshopBounds,2) || boxesOverlap(eggCell,designStoreBounds,2)) {
        const spot = freeChickenCells()[0];
        if (spot) Object.assign(egg,spot);
      }
    });
    if (!state.chicken || state.chicken.column<0 || state.chicken.column>=FIELD.columns ||
      state.chicken.row<0 || state.chicken.row>=FIELD.rows ||
      !cellPlaceable(state.chicken.column,state.chicken.row,true)) {
      state.chicken = freeChickenCells().sort((a,b) =>
        Math.abs(a.column-4)+Math.abs(a.row-2)-Math.abs(b.column-4)-Math.abs(b.row-2))[0] || null;
    }
    renderChicken();
    renderEggs();
    byId("item-menu-move").addEventListener("click",startMovingItem);
    byId("item-menu-sell").addEventListener("click",() => removeManagedItem(true));
    byId("item-menu-delete").addEventListener("click",() => removeManagedItem(false));
    document.addEventListener("pointerdown",event => {
      if (!byId("item-menu").hidden && !byId("item-menu").contains(event.target)) hideItemMenu();
    });
    byId("workshop-button").addEventListener("click",() => toggleWorkshop(byId("workshop-panel").hidden));
    byId("workshop-close").addEventListener("click",() => toggleWorkshop(false));
    byId("design-store-button").addEventListener("click",() => toggleDesignStore(byId("design-panel").hidden));
    byId("design-close").addEventListener("click",() => toggleDesignStore(false));
    updateDemand();
    updateShopSelection();
    renderSoundToggle();
    if (resumed) {
      updateOrderSlots();
      processDueOrders(false);
    } else {
      state.orderTickAtMs = Date.now();
      addOrder(true,{createdAtMs:state.orderTickAtMs});
    }
    byId("sound-toggle").addEventListener("click",() => {
      const control = byId("volume-control");
      control.hidden = !control.hidden;
      renderSoundToggle();
      playSound("click");
    });
    byId("volume-slider").addEventListener("input",event => {
      state.volume = Number(event.target.value)/100;
      state.soundEnabled = state.volume>0;
      backgroundMusic.volume = state.volume;
      renderSoundToggle();
      saveState();
    });
    document.addEventListener("pointerdown",event => {
      const control = byId("volume-control");
      if (!control.hidden && !control.contains(event.target) && !byId("sound-toggle").contains(event.target)) {
        control.hidden = true;
        renderSoundToggle();
      }
    });
    setInterval(updateGrowth,economy.growthUpdateSeconds*1000);
    setInterval(updateWeather,1000);
    setInterval(moveChicken,economy.chicken.stepSeconds*1000);
    setInterval(produceEggs,1000);
    produceEggs();
    scheduleNextOrder();
    window.addEventListener("pagehide",saveState);
    document.addEventListener("visibilitychange",() => {
      if (document.visibilityState==="visible") {
        processDueOrders(false);
        produceEggs();
        updateGrowth();
        updateWeather();
      }
      saveState();
    });
  }).catch(() => { byId("load-error").hidden = false; });
})();
