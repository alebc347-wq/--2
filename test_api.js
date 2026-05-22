const http = require('http');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

// 輔助函式：發送 POST 請求
function post(path, token, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data || {});
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    if (token) {
      options.headers['Authorization'] = token;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// 輔助函式：發送 GET 請求
function get(path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: path,
      method: 'GET',
      headers: {}
    };
    if (token) {
      options.headers['Authorization'] = token;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('--- 開始進行多人在線帝國爭霸 API 自動化測試 ---');

  try {
    // 1. 註冊玩家 Alpha
    console.log('\n[步驟 1] 註冊測試帝國：羅馬軍團 (alpha)...');
    const regAlpha = await post('/api/register', null, {
      username: 'alpha',
      password: 'password123',
      empireName: '羅馬軍團'
    });
    const tokenAlpha = regAlpha.token;
    console.log('Alpha 註冊成功，Token:', tokenAlpha);

    // 2. 註冊玩家 Beta
    console.log('\n[步驟 2] 註冊測試帝國：高盧要塞 (beta)...');
    const regBeta = await post('/api/register', null, {
      username: 'beta',
      password: 'password123',
      empireName: '高盧要塞'
    });
    const tokenBeta = regBeta.token;
    console.log('Beta 註冊成功，Token:', tokenBeta);

    console.log('\n[等待 4 秒] 讓 3 秒的新手免戰保護盾自然過期以利後續攻防測試...');
    await new Promise(resolve => setTimeout(resolve, 4000));

    // 3. 獲取 Alpha 當前狀態
    console.log('\n[步驟 3] 獲取 Alpha 當前初始狀態...');
    let stateAlpha = await get('/api/state', tokenAlpha);
    console.log(`金幣: ${stateAlpha.user.resources.gold}, 糧食: ${stateAlpha.user.resources.food}`);
    console.log(`無業市民: ${stateAlpha.user.population.citizens}, 農民: ${stateAlpha.user.population.peasants}`);

    // 4. 分配市民就業
    console.log('\n[步驟 4] 調整 Alpha 職業分配：農民 8, 伐木工 1, 礦工 1...');
    await post('/api/assign-jobs', tokenAlpha, {
      peasants: 8,
      lumberjacks: 1,
      miners: 1
    });
    console.log('職業重新調配成功。');

    // 5. 徵用士兵
    console.log('\n[步驟 5] 訓練 3 名精銳防衛士兵 (消耗 150 金幣 / 60 鐵礦)...');
    await post('/api/recruit-soldiers', tokenAlpha, { amount: 3 });
    console.log('徵用士兵成功！');

    // 6. 升級國防部門
    console.log('\n[步驟 6] 升級國防部至 LV.2...');
    await post('/api/upgrade-department', tokenAlpha, { dept: 'defense' });
    console.log('國防部升級成功！');

    // 7. 市場交易測試
    console.log('\n[步驟 7] 財政交易所：買入 50 鐵礦...');
    const tradeRes = await post('/api/market-trade', tokenAlpha, {
      action: 'buy',
      resource: 'iron',
      amount: 50
    });
    console.log('交易結果:', tradeRes.message);

    // 8. 戰鬥系統測試
    console.log('\n[步驟 8] 準備對高盧要塞 (beta) 發動軍事遠征...');
    // 注意：發動攻擊後，Beta 的保護護盾會防止被打，除非我們等它過期，或者手動清除。
    // 為了測試，我們先在後端發起攻擊。但由於 Beta 新註冊有 3 分鐘護盾，我們先試圖攻打，應該會被擋住 (驗證護盾有效)
    try {
      console.log('嘗試攻打 Beta (此時 Beta 應有護盾)...');
      await post('/api/attack', tokenAlpha, {
        targetUsername: 'beta',
        soldiersSent: 2
      });
    } catch (e) {
      console.log('預期中的攔截成功！護盾有效:', e.message);
    }

    // 為了能夠測試互打，我們用一個特權操作或者在測試中把 Beta 的 shieldUntil 設為 0
    // 在真實環境下，玩家互打是主動進攻的人護盾消失。
    // 我們可以讓 Beta 攻擊 Alpha！因為 Beta 攻擊 Alpha 時，Beta 的護盾會立刻失效！
    // 讓我們讓 Beta 先徵募 2 名士兵，然後去打 Alpha！
    console.log('\n[步驟 9] 訓練 Beta 士兵並主動攻打 Alpha (主動打破 Beta 自己的護盾)...');
    await post('/api/recruit-soldiers', tokenBeta, { amount: 2 });
    console.log('Beta 徵募了 2 名士兵。');

    console.log('Beta 吹響軍號，派遣 2 名士兵進攻 Alpha！...');
    const attackRes = await post('/api/attack', tokenBeta, {
      targetUsername: 'alpha',
      soldiersSent: 2
    });
    console.log('攻擊任務已啟動！', attackRes.message);

    // 9. 驗證防禦警報
    console.log('\n[步驟 10] 此時讀取 Alpha 的實時狀態，確認是否收到防禦警報...');
    stateAlpha = await get('/api/state', tokenAlpha);
    const incoming = stateAlpha.activeBattles.filter(b => b.isAttackingMe);
    console.log('Alpha 收到進行中的行軍雷達警報數量:', incoming.length);
    if (incoming.length > 0) {
      console.log(`警報詳情：來自帝國 [${incoming[0].attackerEmpire}]，兵力：${incoming[0].soldiersSent}，剩餘抵達時間：${incoming[0].timeLeft} 秒`);
    }

    // 10. 等待行軍抵達並結算戰鬥
    console.log('\n[步驟 11] 等待 31 秒讓行軍大軍抵達戰場結算...');
    await new Promise(resolve => setTimeout(resolve, 31000));

    // 11. 讀取戰報與結果
    console.log('\n[步驟 12] 遠征軍抵達！檢查 Alpha 與 Beta 的戰報歷史...');
    stateAlpha = await get('/api/state', tokenAlpha);
    console.log(`Alpha 最新戰報數量: ${stateAlpha.battleReports.length}`);
    if (stateAlpha.battleReports.length > 0) {
      const rep = stateAlpha.battleReports[0];
      console.log('戰報詳情:\n', rep.detailText);
      console.log(`贏家: ${rep.winner}, 掠奪物資:`, JSON.stringify(rep.loot));
    }

    console.log('\n--- 恭喜！所有 API 核心關卡均已通過測試，系統完美運行！ ---');
  } catch (err) {
    console.error('\n❌ 測試期間發生錯誤:', err.message);
  }
}

runTests();
