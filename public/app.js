// ==========================================
// 多人在線帝國爭霸 | 前端控制核心 (Core Frontend Controller)
// ==========================================

const API_BASE = (window.location.protocol === 'file:' || window.location.origin === 'null')
  ? 'http://localhost:3000'
  : window.location.origin; // 當前伺服器網址
let currentUserToken = localStorage.getItem('empire_token') || null;
let gameState = null;
let localResources = {}; // 用於平滑滾動顯示的本地資源對象
let tickInterval = null;
let pollInterval = null;

// 臨時就業分配狀態（在點擊儲存前僅於前端暫存）
let jobAllocations = {
  peasants: 0,
  lumberjacks: 0,
  miners: 0
};

// ==========================================
// 頁面初始化與生命週期
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  if (currentUserToken) {
    showGameApp();
  } else {
    showAuthScreen();
  }
});

function showAuthScreen() {
  document.getElementById('auth-screen').className = 'screen-active';
  document.getElementById('game-app').className = 'game-hidden';
  stopGameLoops();
}

function showGameApp() {
  document.getElementById('auth-screen').className = 'auth-fields-hidden';
  document.getElementById('game-app').className = '';
  
  // 立即進行第一次同步
  fetchState().then(() => {
    startGameLoops();
  });
}

function startGameLoops() {
  stopGameLoops();
  
  // 1. 每秒本地資源平滑累積 (Local Client-Side Ticker)
  tickInterval = setInterval(() => {
    if (!gameState || !gameState.user) return;
    simulateLocalTick();
  }, 1000);

  // 2. 每 2 秒與伺服器強制同步 (Server Synchronization Loop)
  pollInterval = setInterval(() => {
    fetchState();
  }, 2000);
}

function stopGameLoops() {
  if (tickInterval) clearInterval(tickInterval);
  if (pollInterval) clearInterval(pollInterval);
}

// ==========================================
// 帳號登入 / 註冊與認證處理
// ==========================================
let currentAuthTab = 'login';

function switchAuthTab(tab) {
  currentAuthTab = tab;
  const loginTabBtn = document.getElementById('tab-login-btn');
  const registerTabBtn = document.getElementById('tab-register-btn');
  const regFields = document.getElementById('register-only-fields');
  
  document.getElementById('auth-error').innerText = '';

  if (tab === 'login') {
    loginTabBtn.className = 'auth-tab-active';
    registerTabBtn.className = '';
    regFields.className = 'auth-fields-hidden';
  } else {
    loginTabBtn.className = '';
    registerTabBtn.className = 'auth-tab-active';
    regFields.className = '';
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const username = document.getElementById('auth-username').value;
  const password = document.getElementById('auth-password').value;
  const empireName = document.getElementById('auth-empire').value;
  const errorDiv = document.getElementById('auth-error');

  errorDiv.innerText = '';

  try {
    let url = `${API_BASE}/api/login`;
    let body = { username, password };

    if (currentAuthTab === 'register') {
      url = `${API_BASE}/api/register`;
      body.empireName = empireName || `${username}的大帝國`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || '認證失敗，請檢查資料。');
    }

    // 成功進入
    currentUserToken = data.token;
    localStorage.setItem('empire_token', currentUserToken);
    showGameApp();
  } catch (err) {
    errorDiv.innerText = err.message;
  }
}

function handleLogout() {
  localStorage.removeItem('empire_token');
  currentUserToken = null;
  gameState = null;
  showAuthScreen();
}

// ==========================================
// API 請求發送器 (封裝 Auth Header)
// ==========================================
async function sendRequest(url, method = 'GET', bodyData = null) {
  if (!currentUserToken) {
    handleLogout();
    return null;
  }

  const options = {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': currentUserToken
    }
  };

  if (bodyData) {
    options.body = JSON.stringify(bodyData);
  }

  try {
    const response = await fetch(url, options);
    
    if (response.status === 401) {
      // 憑證過期或無效
      alert('登入憑證失效，請重新登入！');
      handleLogout();
      return null;
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'API 請求失敗。');
    }
    return data;
  } catch (err) {
    console.error(`請求 ${url} 出錯:`, err);
    // 於畫面適當顯示錯誤
    showNotification(err.message, 'danger');
    return null;
  }
}

// ==========================================
// 同步遊戲狀態與渲染 (Fetch & Render Engine)
// ==========================================
async function fetchState() {
  const data = await sendRequest(`${API_BASE}/api/state`);
  if (!data) return;

  gameState = data;
  
  // 伺服器同步時，將本地資源更新為伺服器的精準數值
  localResources = { ...gameState.user.resources };
  
  renderResources();
  renderDashboard();
  renderActiveMarchingAlerts();
  renderCurrentTabState();
}

// 本地平滑累積模擬 (Smooth Idle Progression)
function simulateLocalTick() {
  if (!gameState || !gameState.user) return;

  const user = gameState.user;
  const isSubsidized = user.agriculturalSubsidiesActive;
  const subsidyMultiplier = isSubsidized ? 1.5 : 1.0;

  // 1. 計算糧食與耗糧
  const peasantProdBase = 0.6;
  const cropsTech = user.techs.crops || 0;
  const foodGen = user.population.peasants * peasantProdBase * 
                  (1 + (user.departments.agriculture - 1) * 0.15 + cropsTech * 0.20) * 
                  subsidyMultiplier * (user.population.happiness / 100);

  const totalPop = user.population.citizens + user.population.peasants + 
                   user.population.lumberjacks + user.population.miners + 
                   user.population.soldiers;
  const foodCon = totalPop * 0.04;
  const netFood = foodGen - foodCon;

  // 2. 計算木材與鐵礦
  const techAuto = user.techs.automation || 0;
  const woodGen = user.population.lumberjacks * 0.4 * (1 + techAuto * 0.15) * (user.population.happiness / 100);
  const ironGen = user.population.miners * 0.25 * (1 + techAuto * 0.15) * (user.population.happiness / 100);

  // 3. 計算金幣與維持
  const workingPop = user.population.citizens + user.population.peasants + 
                     user.population.lumberjacks + user.population.miners;
  const goldGen = workingPop * (user.taxRate * 1.2) * (user.population.happiness / 100);
  const soldierCost = user.population.soldiers * 0.08;
  const netGold = goldGen - soldierCost;

  // 4. 科技點數
  const techProp = user.techs.propaganda || 0;
  const tpGen = user.departments.science * 0.1 * (1 + techProp * 0.1);

  // 5. 累積
  // 饑荒判定
  if (localResources.food <= 0 && netFood < 0) {
    localResources.food = 0;
    // 饑荒中本地也模擬人口微幅死亡 (僅做展示，下次 Poll 會由伺服器覆蓋)
  } else {
    localResources.food = Math.max(0, Math.min(
      localResources.food + netFood,
      10000 + (user.departments.agriculture * 5000)
    ));
    localResources.gold = Math.max(0, localResources.gold + netGold);
    localResources.wood = Math.max(0, localResources.wood + woodGen);
    localResources.iron = Math.max(0, localResources.iron + ironGen);
    localResources.techPoints = Math.max(0, localResources.techPoints + tpGen);
  }

  renderResources();
}

// 渲染頂部資源欄
function renderResources() {
  if (!gameState || !gameState.user) return;

  const user = gameState.user;
  document.getElementById('res-empire-name').innerText = user.empireName;
  
  // 新手保護罩徽章
  const shieldBadge = document.getElementById('shield-badge');
  if (user.shieldActive) {
    shieldBadge.style.display = 'inline-flex';
    shieldBadge.innerHTML = `<i class="fa-solid fa-shield-halved"></i> 護盾中 (${user.shieldTimeLeft}s)`;
  } else {
    shieldBadge.style.display = 'none';
  }

  // 填寫數值
  document.getElementById('res-gold').innerText = Math.floor(localResources.gold);
  document.getElementById('res-food').innerText = Math.floor(localResources.food);
  document.getElementById('res-wood').innerText = Math.floor(localResources.wood);
  document.getElementById('res-iron').innerText = Math.floor(localResources.iron);
  document.getElementById('res-tp').innerText = Math.floor(localResources.techPoints);

  // 人口數
  const totalPop = Math.floor(user.population.citizens + user.population.peasants + 
                   user.population.lumberjacks + user.population.miners + 
                   user.population.soldiers);
  document.getElementById('res-pop').innerText = `${Math.floor(user.population.citizens)} / ${totalPop} / ${user.population.maxCapacity}`;

  // 滿意度配色與狀態
  const hapVal = Math.floor(user.population.happiness);
  const hapText = document.getElementById('res-happiness');
  const hapIcon = document.getElementById('happy-icon');
  const hapCard = document.getElementById('happiness-card');
  
  hapText.innerText = `${hapVal}%`;
  
  hapCard.className = 'res-card'; // 重設 class
  if (hapVal >= 70) {
    hapText.className = 'value happy-good';
    hapIcon.innerHTML = `<i class="fa-solid fa-face-smile happy-good"></i>`;
  } else if (hapVal >= 40) {
    hapText.className = 'value happy-warning';
    hapIcon.innerHTML = `<i class="fa-solid fa-face-meh happy-warning"></i>`;
  } else {
    hapText.className = 'value happy-danger';
    hapIcon.innerHTML = `<i class="fa-solid fa-face-frown-open happy-danger-icon"></i>`;
    hapCard.classList.add('happy-danger');
  }
}

// 渲染儀表板 / 內政職業
function renderDashboard() {
  if (!gameState || !gameState.user) return;
  const user = gameState.user;

  // 基礎總覽
  document.getElementById('summary-username').innerText = user.username;
  document.getElementById('summary-power').innerText = calculateEmpirePower(user);
  
  const createdTime = user.createdTime || Date.now();
  const minutesAge = Math.floor((Date.now() - createdTime) / 60000);
  document.getElementById('summary-age').innerText = `${minutesAge} 分鐘`;
  
  document.getElementById('summary-shield').innerText = user.shieldActive ? `保護中 (${user.shieldTimeLeft}s)` : '無安全護盾';
  
  // 帝國官階稱號
  let tier = '一階 荒野部落';
  const power = calculateEmpirePower(user);
  if (power > 3000) tier = '👑 傳奇·星河帝國 👑';
  else if (power > 1200) tier = '五階 軍事帝國';
  else if (power > 600) tier = '四階 中央聯邦';
  else if (power > 300) tier = '三階 自治公國';
  else if (power > 100) tier = '二階 自治領';
  document.getElementById('overview-empire-tier').innerText = tier;

  // 人口就業 (Overview & Employment Counter)
  document.getElementById('overview-unassigned').innerText = `無業遊民: ${Math.floor(user.population.citizens)} 人`;
  document.getElementById('job-peasants-val').innerText = user.population.peasants;
  document.getElementById('job-lumberjacks-val').innerText = user.population.lumberjacks;
  document.getElementById('job-miners-val').innerText = user.population.miners;
  document.getElementById('job-soldiers-val').innerText = user.population.soldiers;

  // 如果前端就業還沒有被初始化過，同步伺服器狀態
  const totalEmployed = jobAllocations.peasants + jobAllocations.lumberjacks + jobAllocations.miners;
  if (totalEmployed === 0) {
    jobAllocations = {
      peasants: user.population.peasants,
      lumberjacks: user.population.lumberjacks,
      miners: user.population.miners
    };
  }

  // 更新前端調整數字
  document.getElementById('job-peasants-val').innerText = jobAllocations.peasants;
  document.getElementById('job-lumberjacks-val').innerText = jobAllocations.lumberjacks;
  document.getElementById('job-miners-val').innerText = jobAllocations.miners;

  // 各政府部門等級
  document.getElementById('overview-dept-defense').innerText = `LV.${user.departments.defense}`;
  document.getElementById('overview-dept-agriculture').innerText = `LV.${user.departments.agriculture}`;
  document.getElementById('overview-dept-finance').innerText = `LV.${user.departments.finance}`;
  document.getElementById('overview-dept-science').innerText = `LV.${user.departments.science}`;
  document.getElementById('overview-dept-interior').innerText = `LV.${user.departments.interior}`;

  // 戰報小標記
  const reportsCount = gameState.battleReports ? gameState.battleReports.length : 0;
  const badge = document.getElementById('report-badge-num');
  badge.innerText = reportsCount;
  if (reportsCount > 0) {
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// 實時軍事防護警報 (Siren Air Raid Alerts)
function renderActiveMarchingAlerts() {
  if (!gameState) return;

  const now = Date.now();
  // 找出是否有正朝我方行軍中的敵軍部隊
  const incomingSiege = gameState.activeBattles.find(b => b.isAttackingMe && b.timeLeft > 0);
  const sirenOverlay = document.getElementById('air-raid-overlay');

  if (incomingSiege) {
    sirenOverlay.className = 'air-raid-active';
    document.getElementById('air-raid-message').innerText = `⚠️ 警告！來自帝國 [${incomingSiege.attackerEmpire}] 的 ${incomingSiege.soldiersSent} 名精銳大軍正在全速推進！我方邊界已發出防空警報！`;
    document.getElementById('air-raid-countdown').innerText = `${incomingSiege.timeLeft}s`;
  } else {
    sirenOverlay.className = 'air-raid-hidden';
  }
}

// 計算綜合實力數值
function calculateEmpirePower(user) {
  const wall = user.military ? user.military.fortifications : 0;
  return Math.floor(
    user.population.soldiers * 15 + 
    (user.departments.defense * 20) + 
    (user.techs.tactics * 30 + user.techs.metallurgy * 30) +
    (user.housing * 10) +
    (user.departments.science * 15)
  );
}

// ==========================================
// 頁籤導航切換 (Tab Navigation Switcher)
// ==========================================
let currentTabId = 'tab-overview';

function switchTab(tabId) {
  currentTabId = tabId;

  // 移除所有 Nav Active
  const navs = document.querySelectorAll('.nav-item');
  navs.forEach(nav => nav.classList.remove('active'));

  // 移除所有 Tab Content Active
  const contents = document.querySelectorAll('.tab-content');
  contents.forEach(content => content.classList.remove('active'));

  // 設置新的 Active
  document.getElementById(tabId).classList.add('active');
  const activeNav = document.getElementById(`btn-${tabId}`);
  if (activeNav) activeNav.classList.add('active');

  // 刷新該分頁內容
  renderCurrentTabState();
}

function renderCurrentTabState() {
  if (!gameState || !gameState.user) return;
  const user = gameState.user;

  switch (currentTabId) {
    case 'tab-defense':
      document.getElementById('def-soldiers-count').innerText = `現役士兵: ${user.population.soldiers} 人`;
      document.getElementById('def-wall-level').innerText = `LV.${user.military.fortifications || 0}`;
      document.getElementById('def-wall-bonus').innerText = `+${(user.military.fortifications || 0) * 25}% 防禦力加成`;

      // 渲染解鎖部隊階級高亮
      const defLevel = user.departments.defense;
      for (let i = 1; i <= 5; i++) {
        const tierEl = document.getElementById(`troop-tier-${i}`);
        if (i === 1) tierEl.className = 'troop-tier-item active-tier';
        else if (i === 2 && defLevel >= 3) tierEl.className = 'troop-tier-item active-tier';
        else if (i === 3 && defLevel >= 5) tierEl.className = 'troop-tier-item active-tier';
        else if (i === 4 && defLevel >= 8) tierEl.className = 'troop-tier-item active-tier';
        else if (i === 5 && defLevel >= 12) tierEl.className = 'troop-tier-item active-tier';
        else tierEl.className = 'troop-tier-item'; // 灰暗
      }
      break;

    case 'tab-agriculture':
      // 開墾廢土成本計算
      const reclaimLvl = user.wastelandReclaimed || 0;
      const woodReclaimCost = Math.floor(300 * Math.pow(1.3, reclaimLvl));
      const ironReclaimCost = Math.floor(150 * Math.pow(1.3, reclaimLvl));
      document.getElementById('agri-reclaim-cost-wood').innerText = woodReclaimCost;
      document.getElementById('agri-reclaim-cost-iron').innerText = ironReclaimCost;

      // 全國農業補貼
      const subsidyCost = Math.floor(400 * user.departments.agriculture);
      document.getElementById('agri-subsidy-cost').innerText = subsidyCost;
      
      const subTimerBox = document.getElementById('subsidy-timer-box');
      if (user.agriculturalSubsidiesActive) {
        subTimerBox.className = 'subsidy-timer-active';
        document.getElementById('agri-subsidy-timer').innerText = `${user.agriculturalSubsidiesTimeLeft}s`;
        document.getElementById('agri-subsidy-btn').disabled = true;
      } else {
        subTimerBox.className = 'subsidy-timer-inactive';
        document.getElementById('agri-subsidy-btn').disabled = false;
      }
      break;

    case 'tab-finance':
      document.getElementById('fin-current-tax').innerText = `目前稅率: ${Math.floor(user.taxRate * 100)}%`;
      document.getElementById('fin-dept-level').innerText = `LV.${user.departments.finance}`;
      const feeDiscount = (user.departments.finance - 1) * 4;
      document.getElementById('fin-fee-discount').innerText = `${feeDiscount}% 手續費減免`;

      // 由於伺服器推送了最新的稅率，重設 slider 與預覽
      if (!document.activeElement || document.activeElement.id !== 'tax-range-input') {
        const slider = document.getElementById('tax-range-input');
        slider.value = Math.floor(user.taxRate * 100);
        updateTaxPreview(slider.value);
      }
      break;

    case 'tab-science':
      // 科技樹等級與成本渲染
      const sciRate = user.departments.science * 0.1 * (1 + (user.techs.propaganda || 0) * 0.1);
      document.getElementById('sci-tp-rate').innerText = `科技研發速度: +${sciRate.toFixed(2)} TP / 秒`;

      const techsList = ['automation', 'crops', 'metallurgy', 'tactics', 'propaganda'];
      techsList.forEach(tech => {
        const lvl = user.techs[tech] || 0;
        const cost = Math.floor(100 * Math.pow(2.2, lvl));
        
        document.getElementById(`tech-lvl-${tech}`).innerText = `LV.${lvl}`;
        document.getElementById(`tech-cost-${tech}`).innerText = `${cost} TP`;
      });
      break;

    case 'tab-interior':
      document.getElementById('int-current-housing').innerText = `目前民房: ${user.housing} 間`;
      const houseCostWood = Math.floor(200 * Math.pow(1.25, user.housing - 2));
      const houseCostGold = Math.floor(100 * Math.pow(1.25, user.housing - 2));
      document.getElementById('int-house-cost-wood').innerText = houseCostWood;
      document.getElementById('int-house-cost-gold').innerText = houseCostGold;

      // 狂歡慶典成本
      const festCostGold = Math.floor(500 * user.departments.interior);
      const festCostFood = Math.floor(300 * user.departments.interior);
      document.getElementById('int-fest-cost-gold').innerText = festCostGold;
      document.getElementById('int-fest-cost-food').innerText = festCostFood;
      break;

    case 'tab-worldmap':
      renderWorldLobby();
      renderMarchingRadar();
      break;

    case 'tab-market':
      // 渲染市場當前波動價
      if (gameState.marketPrices) {
        const p = gameState.marketPrices;
        
        // 財政部折扣計算
        const finBonus = 1 - (user.departments.finance - 1) * 0.04;
        
        const fBuy = (p.food.buy * finBonus).toFixed(2);
        const fSell = (p.food.sell * (2 - finBonus)).toFixed(2);
        document.getElementById('mkt-food-buy').innerText = `🪙${fBuy} 金幣`;
        document.getElementById('mkt-food-sell').innerText = `🪙${fSell} 金幣`;

        const wBuy = (p.wood.buy * finBonus).toFixed(2);
        const wSell = (p.wood.sell * (2 - finBonus)).toFixed(2);
        document.getElementById('mkt-wood-buy').innerText = `🪙${wBuy} 金幣`;
        document.getElementById('mkt-wood-sell').innerText = `🪙${wSell} 金幣`;

        const iBuy = (p.iron.buy * finBonus).toFixed(2);
        const iSell = (p.iron.sell * (2 - finBonus)).toFixed(2);
        document.getElementById('mkt-iron-buy').innerText = `🪙${iBuy} 金幣`;
        document.getElementById('mkt-iron-sell').innerText = `🪙${iSell} 金幣`;
      }
      break;

    case 'tab-leaderboard':
      renderGlobalLeaderboard();
      break;

    case 'tab-reports':
      renderBattleReports();
      break;
  }
}

// ==========================================
// 各部門具體政務 API 請求發起
// ==========================================

// 1. 內政部：儲存市民工作分配
function adjustJob(job, delta) {
  const user = gameState.user;
  const currentTotal = jobAllocations.peasants + jobAllocations.lumberjacks + jobAllocations.miners;
  const totalPop = Math.floor(user.population.citizens) + user.population.peasants + 
                   user.population.lumberjacks + user.population.miners;

  // 計算欲調整的目標
  let newVal = jobAllocations[job] + delta;
  if (newVal < 0) return; // 不能為負

  // 計算是否超載無業市民
  const currentUnassigned = totalPop - currentTotal;
  if (delta > 0 && currentUnassigned <= 0) {
    showNotification('沒有多餘的無業市民可供分配！請先建造住宅擴張人口。', 'warning');
    return;
  }

  jobAllocations[job] = newVal;
  renderDashboard();
}

async function saveJobs() {
  const res = await sendRequest(`${API_BASE}/api/assign-jobs`, 'POST', jobAllocations);
  if (res && res.success) {
    showNotification(res.message, 'success');
    fetchState();
  }
}

// 2. 內政部：建造民房
async function buildHousing() {
  const res = await sendRequest(`${API_BASE}/api/build-housing`, 'POST');
  if (res && res.success) {
    showNotification(res.message, 'success');
    fetchState();
  }
}

// 3. 內政部：舉辦狂歡大典
async function nationalFestival() {
  const res = await sendRequest(`${API_BASE}/api/national-festival`, 'POST');
  if (res && res.success) {
    showNotification(res.message, 'success');
    fetchState();
  }
}

// 4. 農業部：開墾荒地
async function reclaimWaste() {
  const res = await sendRequest(`${API_BASE}/api/reclaim-waste`, 'POST');
  if (res && res.success) {
    showNotification(res.message, 'success');
    fetchState();
  }
}

// 5. 農業部：農業補貼
async function subsidizeAgriculture() {
  const res = await sendRequest(`${API_BASE}/api/subsidize-agriculture`, 'POST');
  if (res && res.success) {
    showNotification(res.message, 'success');
    fetchState();
  }
}

// 6. 財政部：預覽稅率影響
function updateTaxPreview(val) {
  const percent = parseInt(val);
  document.getElementById('tax-slider-preview').innerText = `${percent}%`;

  const forecastVal = 100 - (percent / 100 * 160);
  const forecastText = document.getElementById('tax-happiness-forecast');
  
  if (forecastVal >= 70) {
    forecastText.innerText = `${Math.floor(forecastVal)} / 100 (人民順服，穩定繁榮)`;
    forecastText.className = 'happy-good';
  } else if (forecastVal >= 45) {
    forecastText.innerText = `${Math.floor(forecastVal)} / 100 (有些許怨言，工作效率微降)`;
    forecastText.className = 'happy-warning';
  } else {
    forecastText.innerText = `${Math.max(10, Math.floor(forecastVal))} / 100 (嚴重抗議！即將爆發饑荒和暴動逃離！)`;
    forecastText.className = 'happy-danger';
  }
}

// 7. 財政部：儲存新稅率
async function saveTaxRate() {
  const slider = document.getElementById('tax-range-input');
  const rateVal = parseFloat((slider.value / 100).toFixed(2));
  
  const res = await sendRequest(`${API_BASE}/api/set-tax-rate`, 'POST', { rate: rateVal });
  if (res && res.success) {
    showNotification(res.message, 'success');
    fetchState();
  }
}

// 8. 財政部：交易所買賣
async function tradeResource(action, resource) {
  const amtInput = document.getElementById(`trade-${resource}-amount`);
  const amount = parseInt(amtInput.value);

  if (isNaN(amount) || amount <= 0) {
    showNotification('請輸入大於 0 的正確交易數量！', 'warning');
    return;
  }

  const res = await sendRequest(`${API_BASE}/api/market-trade`, 'POST', {
    action,
    resource,
    amount
  });

  if (res && res.success) {
    showNotification(res.message, 'success');
    amtInput.value = '';
    fetchState();
  }
}

// 9. 科技部：研發科技
async function researchTech(tech) {
  const res = await sendRequest(`${API_BASE}/api/research-tech`, 'POST', { tech });
  if (res && res.success) {
    showNotification(res.message, 'success');
    fetchState();
  }
}

// 10. 國防部：徵募士兵
async function recruitSoldiers() {
  const amtInput = document.getElementById('recruit-input-amount');
  const amount = parseInt(amtInput.value);

  if (isNaN(amount) || amount <= 0) {
    showNotification('請輸入大於 0 的正確徵用士兵人數！', 'warning');
    return;
  }

  const res = await sendRequest(`${API_BASE}/api/recruit-soldiers`, 'POST', { amount });
  if (res && res.success) {
    showNotification(res.message, 'success');
    amtInput.value = '';
    fetchState();
  }
}

// 11. 國防部：加固要塞防禦工事 (城牆)
async function upgradeWall() {
  const res = await sendRequest(`${API_BASE}/api/build-fortifications`, 'POST');
  if (res && res.success) {
    showNotification(res.message, 'success');
    fetchState();
  }
}

// 12. 各部門通用：升級部門本身
async function upgradeDept(dept) {
  const res = await sendRequest(`${API_BASE}/api/upgrade-department`, 'POST', { dept });
  if (res && res.success) {
    showNotification(res.message, 'success');
    fetchState();
  }
}

// ==========================================
// 聯網對外行動 (World Lobby & Attacks)
// ==========================================

// 1. 渲染大廳所有對手
function renderWorldLobby() {
  const tbody = document.getElementById('world-players-tbody');
  tbody.innerHTML = '';

  if (!gameState || !gameState.players || gameState.players.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center">全服目前暫無其他帝國勢力。</td></tr>`;
    return;
  }

  gameState.players.forEach(p => {
    const tr = document.createElement('tr');
    
    // 如果是自己
    if (p.isSelf) {
      tr.innerHTML = `
        <td class="self-label"><i class="fa-solid fa-crown"></i> ${p.empireName} (我方)</td>
        <td class="self-label">${p.username}</td>
        <td class="self-label">${p.power}</td>
        <td class="self-label">${p.population}</td>
        <td class="self-label">🪙${p.gold}</td>
        <td><span class="status-badge status-badge-shield"><i class="fa-solid fa-shield-halved"></i> 駐防中</span></td>
        <td><button disabled class="scout-btn text-muted" style="cursor: not-allowed; opacity: 0.5;">己方行政領地</button></td>
      `;
    } else {
      // 護盾顯示
      const shieldStr = p.shieldActive 
        ? `<span class="status-badge status-badge-shield"><i class="fa-solid fa-shield-halved"></i> 護盾保護中</span>` 
        : `<span class="status-badge status-badge-active"><i class="fa-solid fa-circle-play fa-beat"></i> 處於交戰期</span>`;
      
      const buttonStr = p.shieldActive
        ? `<button disabled class="scout-btn text-muted" style="cursor:not-allowed; opacity: 0.5;">護盾免戰</button>`
        : `<button onclick="openAttackModal('${p.username}', '${p.empireName}')" class="scout-btn glowing-btn mini-tech-btn" style="background: linear-gradient(135deg, var(--neon-red) 0%, #ff5e62 100%) !important; box-shadow: 0 0 10px rgba(255, 0, 85, 0.4) !important; color:#fff !important;">發兵突襲 (Attack)</button>`;

      tr.innerHTML = `
        <td><strong>${p.empireName}</strong></td>
        <td>${p.username}</td>
        <td class="highlight-text">${p.power}</td>
        <td>${p.population} 人</td>
        <td>🪙${p.gold}</td>
        <td>${shieldStr}</td>
        <td>${buttonStr}</td>
      `;
    }
    tbody.appendChild(tr);
  });
}

// 2. 渲染行軍部隊實時進度條 (Marching Radar)
function renderMarchingRadar() {
  const container = document.getElementById('marches-list-container');
  container.innerHTML = '';

  const active = gameState.activeBattles;
  if (!active || active.length === 0) {
    container.innerHTML = `<p class="text-muted text-center py-3">當前無任何行軍中的進攻或防禦部隊。</p>`;
    document.getElementById('active-marches-count').innerText = `目前行軍隊伍: 0 隊`;
    return;
  }

  document.getElementById('active-marches-count').innerText = `目前行軍隊伍: ${active.length} 隊`;

  active.forEach(march => {
    const marchCard = document.createElement('div');
    
    // 行軍類型：我打人，還是人打我
    if (march.isAttackingMe) {
      marchCard.className = 'march-item march-item-defense';
      // 行軍比例倒數 (行軍總時間30秒)
      const ratio = Math.max(0, Math.min(100, ((30 - march.timeLeft) / 30) * 100));
      
      marchCard.innerHTML = `
        <div class="march-header">
          <span class="defense-force-text"><i class="fa-solid fa-triangle-exclamation fa-beat"></i> 紅色防衛戰：[${march.attackerEmpire}] 正在進逼！</span>
          <span class="timer-countdown" style="font-size:1.1rem; text-shadow:none;">抵達剩餘: ${march.timeLeft}秒</span>
        </div>
        <p class="description" style="margin-bottom:5px; font-size:0.8rem;">敵軍部隊派出 ${march.soldiersSent} 名士兵朝我方主權領土挺進，請立刻準備防守！</p>
        <div class="march-progress-track">
          <div class="march-progress-bar march-progress-bar-def" style="width: ${ratio}%"></div>
        </div>
      `;
    } else {
      marchCard.className = 'march-item';
      const ratio = Math.max(0, Math.min(100, ((30 - march.timeLeft) / 30) * 100));
      
      marchCard.innerHTML = `
        <div class="march-header">
          <span class="attack-force-text">⚔️ 境外侵略遠征：進攻 [${march.defenderEmpire}] 帝國</span>
          <span class="timer-countdown" style="font-size:1.1rem; text-shadow:none;">衝鋒剩餘: ${march.timeLeft}秒</span>
        </div>
        <p class="description" style="margin-bottom:5px; font-size:0.8rem;">我方派遣了 ${march.soldiersSent} 名出征戰士。大軍正朝對手大本營行軍挺進中！</p>
        <div class="march-progress-track">
          <div class="march-progress-bar" style="width: ${ratio}%"></div>
        </div>
      `;
    }
    container.appendChild(marchCard);
  });
}

// 3. 渲染排行榜 (Trophy list)
function renderGlobalLeaderboard() {
  const tbody = document.getElementById('leaderboard-tbody');
  tbody.innerHTML = '';

  if (!gameState || !gameState.players) return;

  gameState.players.forEach((p, idx) => {
    const tr = document.createElement('tr');
    
    // 前三名金銀銅樣式
    let rankBadge = '';
    if (idx === 0) rankBadge = `<span class="rank-badge rank-1">1</span>`;
    else if (idx === 1) rankBadge = `<span class="rank-badge rank-2">2</span>`;
    else if (idx === 2) rankBadge = `<span class="rank-badge rank-3">3</span>`;
    else rankBadge = `<span class="rank-badge rank-other">${idx + 1}</span>`;

    const isSelfClass = p.isSelf ? 'class="self-label"' : '';

    tr.innerHTML = `
      <td>${rankBadge}</td>
      <td ${isSelfClass}><strong>${p.empireName} ${p.isSelf ? '(我)' : ''}</strong></td>
      <td ${isSelfClass}>${p.username}</td>
      <td class="highlight-text">${p.power}</td>
      <td>${p.population} 人</td>
      <td>${p.shieldActive ? '<span class="text-accent"><i class="fa-solid fa-shield-halved"></i> 護盾中</span>' : '<span class="text-muted">無護盾</span>'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// 4. 出征突襲 Modal 管理
let currentTargetUser = null;

function openAttackModal(targetUsername, targetEmpireName) {
  currentTargetUser = targetUsername;
  
  const user = gameState.user;
  document.getElementById('modal-target-empire').innerText = targetEmpireName;
  document.getElementById('modal-target-owner').innerText = `@${targetUsername}`;
  
  const maxSoldiers = user.population.soldiers;
  document.getElementById('modal-max-soldiers').innerText = maxSoldiers;
  
  const input = document.getElementById('modal-soldiers-input');
  input.value = '';
  input.max = maxSoldiers;

  // 連動費用監聽
  input.oninput = () => {
    const val = parseInt(input.value) || 0;
    document.getElementById('modal-expedition-cost').innerText = val * 2;
  };
  
  document.getElementById('modal-expedition-cost').innerText = 0;
  
  document.getElementById('dispatch-modal').className = 'screen-active';
}

function setModalMax() {
  const max = gameState.user.population.soldiers;
  const input = document.getElementById('modal-soldiers-input');
  input.value = max;
  document.getElementById('modal-expedition-cost').innerText = max * 2;
}

function closeDispatchModal() {
  document.getElementById('dispatch-modal').className = 'modal-hidden';
  currentTargetUser = null;
}

async function executeAttack() {
  if (!currentTargetUser) return;

  const countInput = document.getElementById('modal-soldiers-input');
  const soldiersSent = parseInt(countInput.value);

  if (isNaN(soldiersSent) || soldiersSent <= 0) {
    showNotification('請輸入大於 0 的派遣兵力！', 'warning');
    return;
  }

  const res = await sendRequest(`${API_BASE}/api/attack`, 'POST', {
    targetUsername: currentTargetUser,
    soldiersSent: soldiersSent
  });

  if (res && res.success) {
    showNotification(res.message, 'success');
    closeDispatchModal();
    fetchState();
    switchTab('tab-worldmap'); // 跳轉到行軍雷達查看進度
  }
}

// ==========================================
// 戰報歷史紀錄 (Battle Reports Engine)
// ==========================================
function renderBattleReports() {
  const container = document.getElementById('reports-list-container');
  container.innerHTML = '';

  const reports = gameState.battleReports;
  if (!reports || reports.length === 0) {
    container.innerHTML = `<p class="text-muted text-center py-5">無任何交戰戰報。快去「聯網世界地圖」發動一場突襲吧！</p>`;
    return;
  }

  reports.forEach(report => {
    const isAttacker = report.attacker === gameState.user.username;
    
    // 判定勝負顏色卡片
    let cardClass = 'report-card ';
    let resultText = '';
    let resultBadgeClass = '';

    if (report.winner === 'attacker' && isAttacker) {
      cardClass += 'report-card-win';
      resultText = '征服大勝利 (Victory)';
      resultBadgeClass = 'result-win';
    } else if (report.winner === 'defender' && !isAttacker) {
      cardClass += 'report-card-win';
      resultText = '要塞守護大勝利 (Defended)';
      resultBadgeClass = 'result-win';
    } else {
      cardClass += 'report-card-lose';
      resultText = '戰敗折損 (Defeat)';
      resultBadgeClass = 'result-lose';
    }

    const formatTime = new Date(report.timestamp).toLocaleString();

    // 掠奪資源卡片
    let lootHtml = '';
    if (report.winner === 'attacker') {
      lootHtml = `
        <div class="report-looted-metrics">
          <span>💰 掠奪戰利品資產總計:</span>
          <strong>🪙金幣: +${report.loot.gold}</strong>
          <strong>🌾糧食: +${report.loot.food}</strong>
          <strong>🪵木材: +${report.loot.wood}</strong>
          <strong>🪙鐵礦: +${report.loot.iron}</strong>
        </div>
      `;
    }

    const rCard = document.createElement('div');
    rCard.className = cardClass;
    rCard.innerHTML = `
      <div class="report-card-header">
        <h4>${isAttacker ? '🚀 境外軍事遠征突襲' : '🛡️ 大本營遭到外來 siege 防衛戰'} <small class="text-muted" style="font-size:0.75rem; margin-left:10px;">${formatTime}</small></h4>
        <span class="result-badge ${resultBadgeClass}">${resultText}</span>
      </div>
      <p class="report-details-txt">${report.detailText}</p>
      
      <div class="report-looted-metrics" style="background:rgba(255,255,255,0.02); border-left: 2px solid var(--neon-cyan); margin-bottom:5px;">
        <span>📊 雙方傷亡對比：</span>
        <span>我軍遠征軍派遣：<strong>${report.soldiersSent}人</strong></span>
        <span>我軍傷亡折損：<strong style="color:var(--neon-red);">${isAttacker ? report.attackerCasualties : report.defenderCasualties}人</strong></span>
        <span>敵軍傷亡折損：<strong style="color:var(--neon-green);">${isAttacker ? report.defenderCasualties : report.attackerCasualties}人</strong></span>
      </div>

      ${lootHtml}
    `;

    container.appendChild(rCard);
  });
}

async function clearReports() {
  if (!confirm('您確定要將國防部檔案夾中備份的所有戰報歷史永久粉碎嗎？此操作不可逆！')) return;
  const res = await sendRequest(`${API_BASE}/api/clear-reports`, 'POST');
  if (res && res.success) {
    showNotification(res.message, 'success');
    fetchState();
  }
}

// ==========================================
// 全域輕量級通知系統 (Global Toast Notification)
// ==========================================
function showNotification(message, type = 'success') {
  const toast = document.createElement('div');
  
  let glowColor = 'var(--neon-cyan)';
  let icon = '<i class="fa-solid fa-circle-check"></i>';
  if (type === 'warning') {
    glowColor = 'var(--neon-gold)';
    icon = '<i class="fa-solid fa-circle-exclamation"></i>';
  } else if (type === 'danger') {
    glowColor = 'var(--neon-red)';
    icon = '<i class="fa-solid fa-triangle-exclamation"></i>';
  }

  toast.style.position = 'fixed';
  toast.style.bottom = '24px';
  toast.style.right = '24px';
  toast.style.background = 'rgba(8, 12, 28, 0.95)';
  toast.style.border = `1px solid ${glowColor}`;
  toast.style.boxShadow = `0 4px 20px rgba(0,0,0,0.5), 0 0 12px ${glowColor}`;
  toast.style.padding = '14px 20px';
  toast.style.borderRadius = '8px';
  toast.style.zIndex = '10000';
  toast.style.color = '#fff';
  toast.style.fontSize = '0.9rem';
  toast.style.display = 'flex';
  toast.style.alignItems = 'center';
  toast.style.gap = '10px';
  toast.style.animation = 'fadeIn 0.3s ease-out';
  toast.innerHTML = `${icon} <span>${message}</span>`;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease-in';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}
