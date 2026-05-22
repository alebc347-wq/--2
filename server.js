const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 資料庫初始化與管理
// ==========================================
let db = {
  users: {},
  battles: [],
  battleReports: []
};

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      db = JSON.parse(data);
      console.log('資料庫加載成功。玩家數量:', Object.keys(db.users || {}).length);
    } else {
      saveDB();
      console.log('已建立全新資料庫。');
    }
  } catch (error) {
    console.error('加載資料庫出錯，使用記憶體預設值:', error);
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (error) {
    console.error('儲存資料庫出錯:', error);
  }
}

// 啟動時加載
loadDB();

// 定時自動儲存 (每 10 秒)
setInterval(() => {
  saveDB();
}, 10000);

// ==========================================
// 怠惰資源增長演算法 (Lazy Resource Formula)
// ==========================================
function calculateUserResources(username) {
  const user = db.users[username];
  if (!user) return null;

  const now = Date.now();
  const elapsedMs = now - user.lastUpdatedTime;
  if (elapsedMs <= 0) return user;

  const elapsedSec = elapsedMs / 1000;
  user.lastUpdatedTime = now;

  // 1. 計算基本加成與科技影響
  const techCrops = user.techs.crops || 0;       // 糧食科技
  const techAuto = user.techs.automation || 0;    // 自動化科技 (木/鐵)
  const techProp = user.techs.propaganda || 0;    // 宣傳科技 (人口吸引/滿意度)

  // 2. 檢驗是否在農業補貼期間
  const isSubsidized = user.agriculturalSubsidiesUntil && now < user.agriculturalSubsidiesUntil;
  const subsidyMultiplier = isSubsidized ? 1.5 : 1.0;

  // 3. 計算生產力與維持費率 (每秒)
  // 農民生產糧食
  const peasantProdBase = 0.6; // 基礎每秒 0.6 糧食
  const foodGenPerSec = user.population.peasants * peasantProdBase * 
                        (1 + (user.departments.agriculture - 1) * 0.15 + techCrops * 0.20) * 
                        subsidyMultiplier * (user.population.happiness / 100);

  // 伐木工生產木材
  const lumberjackProdBase = 0.4;
  const woodGenPerSec = user.population.lumberjacks * lumberjackProdBase * 
                        (1 + techAuto * 0.15) * (user.population.happiness / 100);

  // 礦工生產鐵礦
  const minerProdBase = 0.25;
  const ironGenPerSec = user.population.miners * minerProdBase * 
                        (1 + techAuto * 0.15) * (user.population.happiness / 100);

  // 科技點數生成 (科技部)
  const tpGenPerSec = user.departments.science * 0.1 * (1 + techProp * 0.1);

  // 人口消耗糧食 (每人每秒消耗 0.04 糧食)
  const totalPop = user.population.citizens + user.population.peasants + 
                   user.population.lumberjacks + user.population.miners + 
                   user.population.soldiers;
  const foodConPerSec = totalPop * 0.04;

  // 淨糧食增長率
  const netFoodRate = foodGenPerSec - foodConPerSec;

  // 稅收與軍人維持費 (每秒)
  // 稅率設定：0.05 ~ 0.50。基礎每人貢獻稅率 * 1.5 金幣/秒
  const workingPop = user.population.citizens + user.population.peasants + 
                     user.population.lumberjacks + user.population.miners;
  const goldGenTax = workingPop * (user.taxRate * 1.2) * (user.population.happiness / 100);
  
  // 軍人工資 (每秒 0.08 金幣)
  const soldierCost = user.population.soldiers * 0.08;
  const netGoldRate = goldGenTax - soldierCost;

  // 4. 生存/饑荒判定與資源累積
  if (user.resources.food <= 0 && netFoodRate < 0) {
    // 處於饑荒狀態
    executeStarvation(user, elapsedSec);
  } else if (netFoodRate < 0) {
    // 糧食充裕但正在消耗，計算能維持多久
    const timeToStarve = user.resources.food / (-netFoodRate);
    if (elapsedSec <= timeToStarve) {
      // 離線時間未消耗光糧食
      user.resources.food += netFoodRate * elapsedSec;
      accumulateNonFoodResources(user, elapsedSec, netGoldRate, woodGenPerSec, ironGenPerSec, tpGenPerSec);
      applyHappinessUpdate(user, elapsedSec);
      applyPopulationGrowth(user, elapsedSec);
    } else {
      // 離線途中消耗光了糧食，進入饑荒
      // 1. 耗光糧食前正常產出
      user.resources.food = 0;
      accumulateNonFoodResources(user, timeToStarve, netGoldRate, woodGenPerSec, ironGenPerSec, tpGenPerSec);
      applyHappinessUpdate(user, timeToStarve);
      applyPopulationGrowth(user, timeToStarve);

      // 2. 耗光糧食後進入饑荒階段
      const starveDuration = elapsedSec - timeToStarve;
      executeStarvation(user, starveDuration);
    }
  } else {
    // 糧食為正成長
    user.resources.food = Math.min(
      user.resources.food + netFoodRate * elapsedSec,
      10000 + (user.departments.agriculture * 5000) // 糧倉上限
    );
    accumulateNonFoodResources(user, elapsedSec, netGoldRate, woodGenPerSec, ironGenPerSec, tpGenPerSec);
    applyHappinessUpdate(user, elapsedSec);
    applyPopulationGrowth(user, elapsedSec);
  }

  // 資源底限保護
  user.resources.gold = Math.max(0, user.resources.gold);
  user.resources.food = Math.max(0, user.resources.food);
  user.resources.wood = Math.max(0, user.resources.wood);
  user.resources.iron = Math.max(0, user.resources.iron);
  user.resources.techPoints = Math.max(0, user.resources.techPoints);

  return user;
}

// 累積非糧食資源
function accumulateNonFoodResources(user, duration, netGoldRate, woodGen, ironGen, tpGen) {
  user.resources.gold = Math.max(0, user.resources.gold + netGoldRate * duration);
  user.resources.wood = user.resources.wood + woodGen * duration;
  user.resources.iron = user.resources.iron + ironGen * duration;
  user.resources.techPoints = user.resources.techPoints + tpGen * duration;
}

// 滿意度機制：稅率與饑荒影響
function applyHappinessUpdate(user, duration) {
  // 基礎滿意度朝目標滿意度靠近
  // 稅率 0.1(10%) 為滿意度 80 均衡點。高於 0.1 扣減，低於 0.1 增加
  // 滿意度目標值 = 100 - (稅率 * 150)
  const targetHappiness = Math.max(10, Math.min(100, 100 - (user.taxRate * 160)));
  const diff = targetHappiness - user.population.happiness;
  
  // 每秒移動差值的 2%
  user.population.happiness += diff * (1 - Math.exp(-0.02 * duration));
  user.population.happiness = Math.max(0, Math.min(100, user.population.happiness));
}

// 人口成長機制
function applyPopulationGrowth(user, duration) {
  const totalPop = user.population.citizens + user.population.peasants + 
                   user.population.lumberjacks + user.population.miners + 
                   user.population.soldiers;
  
  if (totalPop >= user.population.maxCapacity) return;

  // 基礎成長率 = 內政部等級 * 0.005 * 滿意度比例 * 宣傳科技加成
  const techProp = user.techs.propaganda || 0;
  const growthRate = user.departments.interior * 0.004 * 
                     (user.population.happiness / 100) * 
                     (1 + techProp * 0.15);
  
  const newCitizens = growthRate * duration;
  user.population.citizens += newCitizens;

  // 確保總人口不超過上限
  const afterTotalPop = user.population.citizens + user.population.peasants + 
                       user.population.lumberjacks + user.population.miners + 
                       user.population.soldiers;
  if (afterTotalPop > user.population.maxCapacity) {
    const overflow = afterTotalPop - user.population.maxCapacity;
    user.population.citizens = Math.max(0, user.population.citizens - overflow);
  }
}

// 饑荒邏輯：人口餓死，滿意度歸零
function executeStarvation(user, duration) {
  user.resources.food = 0;
  user.population.happiness = Math.max(0, user.population.happiness - 10 * duration); // 滿意度暴跌

  // 人口每秒死亡率：總人口的 0.8% + 0.05 人
  const totalPop = user.population.citizens + user.population.peasants + 
                   user.population.lumberjacks + user.population.miners + 
                   user.population.soldiers;
  
  if (totalPop <= 1) return; // 留下一位孤勇者帝王

  let starvedNum = Math.floor((totalPop * 0.01 + 0.08) * duration);
  if (starvedNum <= 0 && duration > 5) starvedNum = 1; // 至少餓死一個

  // 依次餓死職業：無業市民 -> 農民 -> 伐木工 -> 礦工 -> 軍人
  let remainingToStarve = starvedNum;
  
  const jobsOrder = ['citizens', 'peasants', 'lumberjacks', 'miners', 'soldiers'];
  for (const job of jobsOrder) {
    if (user.population[job] >= remainingToStarve) {
      user.population[job] -= remainingToStarve;
      remainingToStarve = 0;
      break;
    } else {
      remainingToStarve -= Math.floor(user.population[job]);
      user.population[job] = 0;
    }
  }
}

// ==========================================
// 行軍與戰鬥結算引擎 (Battle & Matchmaking Engine)
// ==========================================
function resolvePendingBattles() {
  const now = Date.now();
  let dbChanged = false;

  db.battles = db.battles.filter(battle => {
    if (now < battle.arrivalTime) {
      return true; // 繼續前行
    }

    // 時間抵達，開始交戰！
    dbChanged = true;
    const attUser = db.users[battle.attacker];
    const defUser = db.users[battle.defender];

    // 如果玩家已被刪除
    if (!attUser || !defUser) {
      if (attUser) {
        // 退兵
        attUser.population.soldiers += battle.soldiersSent;
      }
      return false;
    }

    // 1. 同步兩方至交戰時間點的資源與人口狀態
    calculateUserResources(battle.attacker);
    calculateUserResources(battle.defender);

    // 2. 計算雙方戰力
    const attTactics = attUser.techs.tactics || 0;
    const defMetallurgy = defUser.techs.metallurgy || 0;
    const defWall = defUser.military.fortifications || 0;

    // 攻擊力：兵力 * 10 * 科技加成 * 隨機係數 (0.8 ~ 1.2)
    const attRand = 0.8 + Math.random() * 0.4;
    const attackerPower = battle.soldiersSent * 10 * (1 + attTactics * 0.20) * attRand;

    // 防禦力：留守兵力 * 10 * (1 + 冶金科技加成) * (1 + 城牆等級*0.25) * 隨機係數
    const defRand = 0.8 + Math.random() * 0.4;
    const defenderPower = defUser.population.soldiers * 10 * 
                          (1 + defMetallurgy * 0.20) * 
                          (1 + defWall * 0.25) * defRand;

    const winner = attackerPower > defenderPower ? 'attacker' : 'defender';

    let attCasualties = 0;
    let defCasualties = 0;
    let loot = { gold: 0, food: 0, wood: 0, iron: 0 };
    let detailText = '';

    const formatTime = new Date().toLocaleTimeString();

    if (winner === 'attacker') {
      // 攻方獲勝！
      // 攻方傷亡公式：防守戰力佔比
      const casualtyRate = Math.min(0.85, defenderPower / (attackerPower * 2));
      attCasualties = Math.floor(battle.soldiersSent * casualtyRate);
      
      // 防方軍隊慘敗：損失 85% ~ 100% 的留守部隊
      defCasualties = Math.max(
        Math.floor(defUser.population.soldiers * (0.8 + Math.random() * 0.2)),
        Math.min(defUser.population.soldiers, 1)
      );

      // 掠奪防方 30% ~ 45% 的當前資源
      const lootRate = 0.30 + Math.random() * 0.15;
      loot.gold = Math.floor(defUser.resources.gold * lootRate);
      loot.food = Math.floor(defUser.resources.food * lootRate);
      loot.wood = Math.floor(defUser.resources.wood * lootRate);
      loot.iron = Math.floor(defUser.resources.iron * lootRate);

      // 扣除防守方資源
      defUser.resources.gold -= loot.gold;
      defUser.resources.food -= loot.food;
      defUser.resources.wood -= loot.wood;
      defUser.resources.iron -= loot.iron;

      // 剩餘的進攻士兵帶著物資凱旋而歸
      const survivors = battle.soldiersSent - attCasualties;
      attUser.population.soldiers += survivors;
      
      attUser.resources.gold += loot.gold;
      attUser.resources.food += loot.food;
      attUser.resources.wood += loot.wood;
      attUser.resources.iron += loot.iron;

      detailText = `[${formatTime}] ⚔️ 帝國 [${attUser.empireName}] 的軍隊突破了 [${defUser.empireName}] 的要塞防線！「國防部」傳回捷報！我軍展現了無畏的英勇姿態，在攻城器械與戰術配合下，強行撕裂了對方的防空與步兵防守。雖然損失了 ${attCasualties} 名勇士，但順利殲滅對方 ${defCasualties} 名守軍！並從對方的國庫中大肆掠奪了 🪙${loot.gold}金幣、🌾${loot.food}糧食、🪵${loot.wood}木材以及 🪙${loot.iron}鐵礦！`;
    } else {
      // 防方獲勝！
      // 攻方潰敗：損失 70% ~ 95% 兵力
      attCasualties = Math.floor(battle.soldiersSent * (0.7 + Math.random() * 0.25));
      const casualtyRate = Math.min(0.80, attackerPower / (defenderPower * 2));
      defCasualties = Math.floor(defUser.population.soldiers * casualtyRate);

      // 剩餘殘兵敗退回家
      const survivors = battle.soldiersSent - attCasualties;
      attUser.population.soldiers += survivors;

      detailText = `[${formatTime}] 🛡️ 帝國 [${defUser.empireName}] 成功擊退了來自 [${attUser.empireName}] 的突襲部隊！「國防部」慶功宴開始！防禦城牆與守軍爆發出驚人的防守韌性。在科技裝備與要塞防禦工事的加持下，成功將敵軍攔截在邊界外！我方付出 ${defCasualties} 名防守士兵的代價，全殲了敵方 ${attCasualties} 名侵略軍！敵軍殘部丟盔棄甲狼狽撤離！`;
    }

    // 扣除防守方傷亡
    defUser.population.soldiers = Math.max(0, defUser.population.soldiers - defCasualties);

    // 建立精緻戰報
    const report = {
      id: Math.random().toString(36).substr(2, 9),
      attacker: battle.attacker,
      defender: battle.defender,
      attackerEmpire: attUser.empireName,
      defenderEmpire: defUser.empireName,
      soldiersSent: battle.soldiersSent,
      attackerCasualties: attCasualties,
      defenderCasualties: defCasualties,
      winner: winner,
      loot: loot,
      timestamp: now,
      detailText: detailText
    };

    db.battleReports.unshift(report);
    // 限制戰報數量 100 筆
    if (db.battleReports.length > 100) {
      db.battleReports.pop();
    }

    // 戰鬥結束，防守方獲得 1 分鐘的免戰護盾，防止被連續轟炸
    defUser.shieldUntil = now + 60000;

    return false; // 移除此戰役
  });

  if (dbChanged) {
    saveDB();
  }
}

// 每秒輪詢處理行軍隊伍
setInterval(() => {
  resolvePendingBattles();
}, 1000);

// ==========================================
// 中介軟體 (Middleware) - 驗證 Token (簡單字串模擬)
// ==========================================
function authenticateUser(req, res, next) {
  const token = req.headers['authorization'] || req.query.token;
  if (!token) {
    return res.status(401).json({ error: '未提供授權憑證。' });
  }

  const username = token; // 為了簡單起見，直接使用 username 作為 token
  if (!db.users[username]) {
    return res.status(401).json({ error: '憑證無效，請重新登入。' });
  }

  req.username = username;
  // 先更新資源狀態再進入路由邏輯
  calculateUserResources(username);
  next();
}

// ==========================================
// 帳號認證 API (Authentication API)
// ==========================================
app.post('/api/register', (req, res) => {
  const { username, password, empireName } = req.body;

  if (!username || !password || !empireName) {
    return res.status(400).json({ error: '所有欄位均為必填！' });
  }

  const cleanUser = username.trim().toLowerCase();
  if (db.users[cleanUser]) {
    return res.status(400).json({ error: '該帳號名稱已被註冊！' });
  }

  // 檢查帝國名稱是否重覆
  const empireExists = Object.values(db.users).some(u => u.empireName === empireName.trim());
  if (empireExists) {
    return res.status(400).json({ error: '該帝國名稱已被佔用！' });
  }

  const now = Date.now();
  db.users[cleanUser] = {
    username: cleanUser,
    password: password,
    empireName: empireName.trim(),
    createdTime: now,
    lastUpdatedTime: now,
    shieldUntil: now + 3000, // 測試便利性：設為 3 秒新手護盾保護 (方便立即體驗攻防與紅光防衛警報)
    resources: {
      gold: 1000,
      food: 1000,
      wood: 800,
      iron: 400,
      techPoints: 0
    },
    population: {
      maxCapacity: 20,
      citizens: 10,
      peasants: 5,
      lumberjacks: 3,
      miners: 2,
      soldiers: 0,
      happiness: 100
    },
    departments: {
      defense: 1,
      agriculture: 1,
      finance: 1,
      science: 1,
      interior: 1
    },
    techs: {
      automation: 0,
      crops: 0,
      metallurgy: 0,
      tactics: 0,
      propaganda: 0
    },
    military: {
      fortifications: 0
    },
    housing: 2,
    wastelandReclaimed: 0,
    agriculturalSubsidiesUntil: 0,
    taxRate: 0.10 // 預設 10% 稅率
  };

  saveDB();
  res.json({ success: true, token: cleanUser });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '帳號與密碼為必填！' });
  }

  const cleanUser = username.trim().toLowerCase();
  const user = db.users[cleanUser];

  if (!user || user.password !== password) {
    return res.status(400).json({ error: '帳號或密碼錯誤！' });
  }

  // 更新資源
  calculateUserResources(cleanUser);
  saveDB();

  res.json({ success: true, token: cleanUser });
});

// ==========================================
// 核心遊戲狀態與世界 API
// ==========================================
app.get('/api/state', authenticateUser, (req, res) => {
  const user = db.users[req.username];
  
  // 獲取玩家清單（排除自己）
  const now = Date.now();
  const players = Object.values(db.users).map(p => {
    // 獲取實時數據
    // 注意：只做唯讀計算以獲取對手最新狀態，不寫入 lastUpdatedTime 以防對手計算錯亂，但這裡簡單計算其資源
    const tempUser = JSON.parse(JSON.stringify(p));
    // 簡單模擬 lazy 運算
    const elapsedSec = (now - tempUser.lastUpdatedTime) / 1000;
    let tempGold = tempUser.resources.gold;
    if (elapsedSec > 0) {
      const working = tempUser.population.citizens + tempUser.population.peasants + 
                      tempUser.population.lumberjacks + tempUser.population.miners;
      tempGold = Math.max(0, tempGold + (working * tempUser.taxRate * 0.2 - tempUser.population.soldiers * 0.08) * elapsedSec);
    }

    const totalPop = p.population.citizens + p.population.peasants + 
                     p.population.lumberjacks + p.population.miners + 
                     p.population.soldiers;

    const power = p.population.soldiers * 15 + 
                  (p.departments.defense * 20) + 
                  (p.techs.tactics * 30 + p.techs.metallurgy * 30);

    return {
      username: p.username,
      empireName: p.empireName,
      power: Math.floor(power),
      population: Math.floor(totalPop),
      shieldUntil: p.shieldUntil,
      shieldActive: p.shieldUntil && now < p.shieldUntil,
      gold: Math.floor(tempGold),
      isSelf: p.username === req.username
    };
  }).sort((a, b) => b.power - a.power); // 排行榜

  // 獲取與該玩家相關的軍事行動 (行軍中)
  const activeBattles = db.battles.map(b => {
    return {
      id: b.id,
      attackerEmpire: db.users[b.attacker]?.empireName || b.attacker,
      defenderEmpire: db.users[b.defender]?.empireName || b.defender,
      isAttackingMe: b.defender === req.username,
      isMyAttack: b.attacker === req.username,
      soldiersSent: b.soldiersSent,
      timeLeft: Math.max(0, Math.floor((b.arrivalTime - now) / 1000))
    };
  });

  // 獲取與該玩家相關的歷史戰報
  const myReports = db.battleReports.filter(r => r.attacker === req.username || r.defender === req.username);

  // 動態市場價格計算
  const wave = Math.sin(now / 300000); // 5分鐘一個正弦波週期
  const dynamicPrices = {
    food: { buy: parseFloat((1.2 + wave * 0.25).toFixed(2)), sell: parseFloat((0.8 + wave * 0.20).toFixed(2)) },
    wood: { buy: parseFloat((1.5 - wave * 0.30).toFixed(2)), sell: parseFloat((1.0 - wave * 0.25).toFixed(2)) },
    iron: { buy: parseFloat((3.0 + wave * 0.60).toFixed(2)), sell: parseFloat((2.0 + wave * 0.40).toFixed(2)) }
  };

  res.json({
    user: {
      username: user.username,
      empireName: user.empireName,
      shieldActive: user.shieldUntil && now < user.shieldUntil,
      shieldTimeLeft: user.shieldUntil ? Math.max(0, Math.floor((user.shieldUntil - now) / 1000)) : 0,
      resources: {
        gold: Math.floor(user.resources.gold),
        food: Math.floor(user.resources.food),
        wood: Math.floor(user.resources.wood),
        iron: Math.floor(user.resources.iron),
        techPoints: Math.floor(user.resources.techPoints)
      },
      population: {
        maxCapacity: user.population.maxCapacity,
        citizens: Math.floor(user.population.citizens),
        peasants: user.population.peasants,
        lumberjacks: user.population.lumberjacks,
        miners: user.population.miners,
        soldiers: user.population.soldiers,
        happiness: Math.floor(user.population.happiness)
      },
      departments: user.departments,
      techs: user.techs,
      military: user.military,
      housing: user.housing,
      wastelandReclaimed: user.wastelandReclaimed,
      agriculturalSubsidiesActive: user.agriculturalSubsidiesUntil && now < user.agriculturalSubsidiesUntil,
      agriculturalSubsidiesTimeLeft: user.agriculturalSubsidiesUntil ? Math.max(0, Math.floor((user.agriculturalSubsidiesUntil - now) / 1000)) : 0,
      taxRate: user.taxRate
    },
    players: players,
    activeBattles: activeBattles,
    battleReports: myReports,
    marketPrices: dynamicPrices
  });
});

// ==========================================
// 內政部 (Ministry of Interior) 動作
// ==========================================

// 1. 分配職業
app.post('/api/assign-jobs', authenticateUser, (req, res) => {
  const user = db.users[req.username];
  const { peasants, lumberjacks, miners } = req.body;

  if (peasants === undefined || lumberjacks === undefined || miners === undefined) {
    return res.status(400).json({ error: '職業分配數量不完整！' });
  }

  const targetPeasants = parseInt(peasants);
  const targetLumberjacks = parseInt(lumberjacks);
  const targetMiners = parseInt(miners);

  if (targetPeasants < 0 || targetLumberjacks < 0 || targetMiners < 0) {
    return res.status(400).json({ error: '分配人數不能為負數！' });
  }

  const totalEmployed = targetPeasants + targetLumberjacks + targetMiners;
  const currentTotalPop = Math.floor(user.population.citizens) + user.population.peasants + 
                         user.population.lumberjacks + user.population.miners;
  
  if (totalEmployed > currentTotalPop) {
    return res.status(400).json({ error: '分配總人數超出了帝國市民總數！' });
  }

  // 重新分配
  const citizensLeft = currentTotalPop - totalEmployed;
  user.population.citizens = citizensLeft;
  user.population.peasants = targetPeasants;
  user.population.lumberjacks = targetLumberjacks;
  user.population.miners = targetMiners;

  saveDB();
  res.json({ success: true, message: '帝國職業重新分配成功！' });
});

// 2. 建造民房 (增加人口上限)
app.post('/api/build-housing', authenticateUser, (req, res) => {
  const user = db.users[req.username];
  
  // 升級民房消耗：基礎木材 200, 金幣 100。每級遞增 25%
  const houseCostWood = Math.floor(200 * Math.pow(1.25, user.housing - 2));
  const houseCostGold = Math.floor(100 * Math.pow(1.25, user.housing - 2));

  if (user.resources.wood < houseCostWood || user.resources.gold < houseCostGold) {
    return res.status(400).json({ error: `資源不足！建造下一間民房需要 🪵${houseCostWood}木材 與 🪙${houseCostGold}金幣。` });
  }

  user.resources.wood -= houseCostWood;
  user.resources.gold -= houseCostGold;
  user.housing += 1;
  user.population.maxCapacity += 10; // 每間房屋增加 10 人口上限

  saveDB();
  res.json({ success: true, message: `民房建造成功！人口上限已提升至 ${user.population.maxCapacity}人！` });
});

// 3. 舉辦國家慶典 (瞬間回滿滿意度)
app.post('/api/national-festival', authenticateUser, (req, res) => {
  const user = db.users[req.username];
  
  const festivalCostGold = Math.floor(500 * user.departments.interior);
  const festivalCostFood = Math.floor(300 * user.departments.interior);

  if (user.resources.gold < festivalCostGold || user.resources.food < festivalCostFood) {
    return res.status(400).json({ error: `資源不足！舉辦帝國狂歡慶典需要 🪙${festivalCostGold}金幣 與 🌾${festivalCostFood}糧食。` });
  }

  user.resources.gold -= festivalCostGold;
  user.resources.food -= festivalCostFood;
  user.population.happiness = 100; // 瞬間恢復至滿分滿意度

  saveDB();
  res.json({ success: true, message: '普天同慶！帝國狂歡盛典成功舉辦，人民滿意度達到了 100%！' });
});

// ==========================================
// 農業部 (Ministry of Agriculture) 動作
// ==========================================

// 1. 開墾廢土 (花費木材與鐵礦，新增 5 位市民)
app.post('/api/reclaim-waste', authenticateUser, (req, res) => {
  const user = db.users[req.username];
  
  const totalPop = user.population.citizens + user.population.peasants + 
                   user.population.lumberjacks + user.population.miners + 
                   user.population.soldiers;

  if (totalPop + 5 > user.population.maxCapacity) {
    return res.status(400).json({ error: '帝國住房不足！請先建造民居以擴展人口上限，才能容納開墾來的人口。' });
  }

  const woodCost = Math.floor(300 * Math.pow(1.3, user.wastelandReclaimed));
  const ironCost = Math.floor(150 * Math.pow(1.3, user.wastelandReclaimed));

  if (user.resources.wood < woodCost || user.resources.iron < ironCost) {
    return res.status(400).json({ error: `資源不足！開墾荒野需要 🪵${woodCost}木材 與 🪙${ironCost}鐵礦。` });
  }

  user.resources.wood -= woodCost;
  user.resources.iron -= ironCost;
  user.wastelandReclaimed += 1;
  user.population.citizens += 5; // 獲得 5 個全新移民

  saveDB();
  res.json({ success: true, message: '荒地開墾成功！招募到了 5 名全新市民為帝國服務！' });
});

// 2. 發放農業補貼 (花費金幣，2分鐘內農民產出提升 50%)
app.post('/api/subsidize-agriculture', authenticateUser, (req, res) => {
  const user = db.users[req.username];
  
  const subsidyCost = Math.floor(400 * user.departments.agriculture);
  if (user.resources.gold < subsidyCost) {
    return res.status(400).json({ error: `資源不足！發放全體農業補貼需要 🪙${subsidyCost}金幣。` });
  }

  user.resources.gold -= subsidyCost;
  const now = Date.now();
  user.agriculturalSubsidiesUntil = now + 120000; // 2分鐘補貼加成 (120 秒)

  saveDB();
  res.json({ success: true, message: '農業補貼發放成功！接下來 2 分鐘農民糧食產量提升 50%！' });
});

// ==========================================
// 財政部 (Ministry of Finance) 動作
// ==========================================

// 1. 設定稅率
app.post('/api/set-tax-rate', authenticateUser, (req, res) => {
  const user = db.users[req.username];
  const { rate } = req.body;

  const taxRate = parseFloat(rate);
  if (isNaN(taxRate) || taxRate < 0.05 || taxRate > 0.50) {
    return res.status(400).json({ error: '稅率調整範圍必須在 5% (0.05) 到 50% (0.50) 之間！' });
  }

  user.taxRate = taxRate;
  saveDB();
  res.json({ success: true, message: `帝國稅率成功調整為 ${Math.floor(taxRate * 100)}%！` });
});

// 2. 市場交易 (買賣資源)
app.post('/api/market-trade', authenticateUser, (req, res) => {
  const user = db.users[req.username];
  const { action, resource, amount } = req.body; // action: 'buy'/'sell', resource: 'food'/'wood'/'iron'

  const tradeAmount = parseInt(amount);
  if (isNaN(tradeAmount) || tradeAmount <= 0) {
    return res.status(400).json({ error: '交易數量必須大於 0！' });
  }

  // 獲取當前價格
  const now = Date.now();
  const wave = Math.sin(now / 300000);
  const basePrices = {
    food: { buy: 1.2 + wave * 0.25, sell: 0.8 + wave * 0.20 },
    wood: { buy: 1.5 - wave * 0.30, sell: 1.0 - wave * 0.25 },
    iron: { buy: 3.0 + wave * 0.60, sell: 2.0 + wave * 0.40 }
  };

  const prices = basePrices[resource];
  if (!prices) {
    return res.status(400).json({ error: '無效的資源交易類別！' });
  }

  // 財政部等級折扣：最高 10 級，每級扣減 4% 交易稅/溢價 (即減免手續費)
  const financeBonus = 1 - (user.departments.finance - 1) * 0.04;
  const buyPrice = parseFloat((prices.buy * financeBonus).toFixed(2));
  const sellPrice = parseFloat((prices.sell * (2 - financeBonus)).toFixed(2));

  if (action === 'buy') {
    const totalCost = Math.floor(buyPrice * tradeAmount);
    if (user.resources.gold < totalCost) {
      return res.status(400).json({ error: `金幣不足！購買 ${tradeAmount}單位 ${resource} 需要 🪙${totalCost}金幣，當前僅有 🪙${Math.floor(user.resources.gold)}。` });
    }

    user.resources.gold -= totalCost;
    user.resources[resource] += tradeAmount;
    saveDB();
    return res.json({ success: true, message: `交易成功！花费了 🪙${totalCost}金幣 購買了 ${tradeAmount}單位 ${resource}。` });
  } else if (action === 'sell') {
    if (user.resources[resource] < tradeAmount) {
      return res.status(400).json({ error: `資源存貨不足！您僅有 ${Math.floor(user.resources[resource])}單位 ${resource}。` });
    }

    const totalRevenue = Math.floor(sellPrice * tradeAmount);
    user.resources[resource] -= tradeAmount;
    user.resources.gold += totalRevenue;
    saveDB();
    return res.json({ success: true, message: `交易成功！賣出了 ${tradeAmount}單位 ${resource} 獲得了 🪙${totalRevenue}金幣。` });
  }

  res.status(400).json({ error: '交易動作無效。' });
});

// ==========================================
// 科技部 (Ministry of Science & Technology) 動作
// ==========================================
app.post('/api/research-tech', authenticateUser, (req, res) => {
  const user = db.users[req.username];
  const { tech } = req.body; // 'automation', 'crops', 'metallurgy', 'tactics', 'propaganda'

  if (user.techs[tech] === undefined) {
    return res.status(400).json({ error: '無效的科技類別！' });
  }

  const currentLevel = user.techs[tech];
  // 研發消耗科技點數：基礎 100, 每級以 2 倍遞增
  const techCost = Math.floor(100 * Math.pow(2.2, currentLevel));

  if (user.resources.techPoints < techCost) {
    return res.status(400).json({ error: `科技點數不足！研發下一級科技需要 ⚡${techCost}科技點，當前僅有 ⚡${Math.floor(user.resources.techPoints)}。` });
  }

  user.resources.techPoints -= techCost;
  user.techs[tech] += 1;

  saveDB();
  res.json({ success: true, message: `科研突破！科技 [${tech}] 已成功升級至等級 ${user.techs[tech]}！` });
});

// ==========================================
// 國防部 (Ministry of Defense) 動作
// ==========================================

// 1. 徵召士兵 (Unassigned Citizens -> Soldiers)
app.post('/api/recruit-soldiers', authenticateUser, (req, res) => {
  const user = db.users[req.username];
  const { amount } = req.body;

  const recruitAmount = parseInt(amount);
  if (isNaN(recruitAmount) || recruitAmount <= 0) {
    return res.status(400).json({ error: '徵募數量必須大於 0！' });
  }

  if (Math.floor(user.population.citizens) < recruitAmount) {
    return res.status(400).json({ error: '無業市民數量不足，無法徵募士兵！請先開墾廢土或等待人口自然增長。' });
  }

  // 徵兵成本：每位士兵消耗 🪙50金幣 與 🪙20鐵礦
  const recruitCostGold = recruitAmount * 50;
  const recruitCostIron = recruitAmount * 20;

  if (user.resources.gold < recruitCostGold || user.resources.iron < recruitCostIron) {
    return res.status(400).json({ error: `資源不足！徵募 ${recruitAmount} 名士兵需要 🪙${recruitCostGold}金幣 與 🪙${recruitCostIron}鐵礦。` });
  }

  user.resources.gold -= recruitCostGold;
  user.resources.iron -= recruitCostIron;
  user.population.citizens -= recruitAmount;
  user.population.soldiers += recruitAmount;

  saveDB();
  res.json({ success: true, message: `徵兵完畢！${recruitAmount} 名勇士已加入帝國國防軍！` });
});

// 2. 升級要塞防線 (城牆)
app.post('/api/build-fortifications', authenticateUser, (req, res) => {
  const user = db.users[req.username];
  
  const currentWall = user.military.fortifications || 0;
  const wallCostWood = Math.floor(300 * Math.pow(1.35, currentWall));
  const wallCostIron = Math.floor(150 * Math.pow(1.35, currentWall));

  if (user.resources.wood < wallCostWood || user.resources.iron < wallCostIron) {
    return res.status(400).json({ error: `資源不足！升級要塞防禦牆需要 🪵${wallCostWood}木材 與 🪙${wallCostIron}鐵礦。` });
  }

  user.resources.wood -= wallCostWood;
  user.resources.iron -= wallCostIron;
  user.military.fortifications = currentWall + 1;

  saveDB();
  res.json({ success: true, message: `要塞工事升級完畢！城牆防禦等級提升至 LV.${user.military.fortifications}，獲得額外 25% 防守力加成！` });
});

// 3. 發動進攻！ (Marching attack)
app.post('/api/attack', authenticateUser, (req, res) => {
  const user = db.users[req.username];
  const { targetUsername, soldiersSent } = req.body;

  const count = parseInt(soldiersSent);
  if (isNaN(count) || count <= 0) {
    return res.status(400).json({ error: '派遣兵力必須大於 0！' });
  }

  if (user.population.soldiers < count) {
    return res.status(400).json({ error: `守軍兵力不足！您僅有 ${user.population.soldiers} 名士兵可供派遣。` });
  }

  if (user.username === targetUsername.trim().toLowerCase()) {
    return res.status(400).json({ error: '您不能對自己的帝國發動攻擊！' });
  }

  const defender = db.users[targetUsername.trim().toLowerCase()];
  if (!defender) {
    return res.status(404).json({ error: '目標帝國不存在！' });
  }

  // 檢查免戰護盾
  const now = Date.now();
  if (defender.shieldUntil && now < defender.shieldUntil) {
    const timeLeft = Math.floor((defender.shieldUntil - now) / 1000);
    return res.status(400).json({ error: `目標帝國正處於「免戰護盾」保護中！保護期剩餘 ${timeLeft} 秒。` });
  }

  // 進攻消耗金幣作為軍費 (每士兵 2 金幣)
  const armyExpeditionCost = count * 2;
  if (user.resources.gold < armyExpeditionCost) {
    return res.status(400).json({ error: `軍費不足！派出軍隊需要支付 🪙${armyExpeditionCost}金幣 作為行軍補給維持費。` });
  }

  // 扣除兵力與軍費
  user.population.soldiers -= count;
  user.resources.gold -= armyExpeditionCost;

  // 建立進攻行軍任務 (行軍 30 秒)
  const travelTime = 30000; // 30秒
  const arrivalTime = now + travelTime;

  const newBattle = {
    id: Math.random().toString(36).substr(2, 9),
    attacker: user.username,
    defender: defender.username,
    soldiersSent: count,
    departureTime: now,
    arrivalTime: arrivalTime,
    resolved: false
  };

  db.battles.push(newBattle);
  
  // 一旦主動攻擊，進攻方的保護罩立刻失效！
  user.shieldUntil = 0;

  saveDB();
  res.json({ success: true, message: `出征號角吹響！您的 ${count} 名精銳部隊已朝 [${defender.empireName}] 帝國行軍，預計 30 秒後抵達戰場！` });
});

// ==========================================
// 各部門通用升級 API
// ==========================================
app.post('/api/upgrade-department', authenticateUser, (req, res) => {
  const user = db.users[req.username];
  const { dept } = req.body; // 'defense', 'agriculture', 'finance', 'science', 'interior'

  if (user.departments[dept] === undefined) {
    return res.status(400).json({ error: '無效的政府部門名稱！' });
  }

  const currentLevel = user.departments[dept];
  if (currentLevel >= 15) {
    return res.status(400).json({ error: '該政府部門已達到 LV.15 的最高等級上限！' });
  }

  // 升級成本：基礎 300 金、200 木、100 鐵，每級按指數 1.45 倍遞增
  const costMultiplier = Math.pow(1.45, currentLevel - 1);
  const costGold = Math.floor(300 * costMultiplier);
  const costWood = Math.floor(200 * costMultiplier);
  const costIron = Math.floor(100 * costMultiplier);

  if (user.resources.gold < costGold || user.resources.wood < costWood || user.resources.iron < costIron) {
    return res.status(400).json({ error: `資源不足！升級此政府部門需要：🪙${costGold}金幣、🪵${costWood}木材、🪙${costIron}鐵礦。` });
  }

  // 扣除並升級
  user.resources.gold -= costGold;
  user.resources.wood -= costWood;
  user.resources.iron -= costIron;
  user.departments[dept] += 1;

  saveDB();
  res.json({ success: true, message: `祝賀！您的政府單位 [${dept.toUpperCase()}] 已成功升級至 LV.${user.departments[dept]}！` });
});

// ==========================================
// 刪除戰報
// ==========================================
app.post('/api/clear-reports', authenticateUser, (req, res) => {
  // 過濾掉和該玩家有關的戰報
  db.battleReports = db.battleReports.filter(r => r.attacker !== req.username && r.defender !== req.username);
  saveDB();
  res.json({ success: true, message: '戰報歷史已全部清空！' });
});

// ==========================================
// 伺服器啟動
// ==========================================
app.listen(PORT, () => {
  console.log(`帝國爭霸伺服器正在 port ${PORT} 上奔馳... 開啟瀏覽器玩遊戲吧！`);
});
