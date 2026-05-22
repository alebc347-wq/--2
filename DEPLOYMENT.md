# 🌌 多人在線帝國爭霸 - 雲端部署指南 (Cloud Deployment Guide)

本指南將引導您將《多人在線帝國爭霸》部署至公網雲端平台，讓全世界任何網路的朋友只需打開您分享的專用網址，就能直接對打、搶奪資源！

---

## 🏆 第一步：將程式碼上傳至 GitHub (前置作業)

無論您要部署到哪一個免費雲端平台，都需要先將程式碼放上 GitHub：

1. **安裝 Git** (若您電腦尚未安裝，請前往 [git-scm.com](https://git-scm.com/) 下載安裝)。
2. **打開命令提示字元 (CMD) 或 PowerShell**，並將工作目錄切換到本遊戲的專案資料夾下：
   ```bash
   cd c:\Users\caleb\Desktop\ai\empire_game
   ```
3. **執行 Git 初始化與首次提交**：
   ```bash
   # 1. 初始化 Git 倉庫
   git init

   # 2. 將所有檔案加入暫存區（本機已自動配置 .gitignore，會自動排除 node_modules 與您的本地測試 db.json）
   git add .

   # 3. 提交至本地倉庫
   git commit -m "feat: deploy empire online multiplayer game"
   ```
4. **在 GitHub 建立新倉庫**：
   * 前往並登入 [GitHub](https://github.com/)。
   * 點擊右上角 **「New」** 建立一個新的 Repository。
   * 輸入名稱（例如 `empire-online`），並選擇 **Private (私有，推薦)** 或 **Public (公開)**。
   * **不要**勾選 "Add a README file"、"Add .gitignore" 或 "Choose a license"（因為本機專案已存在）。
   * 點擊 **「Create repository」**。
5. **將程式碼推送至 GitHub**：
   在 GitHub 頁面上複製下面三行指令，並在您的本機 CMD/PowerShell 中貼上並執行：
   ```bash
   git branch -M main
   git remote add origin https://github.com/【您的GitHub帳號】/【您的Repository名稱】.git
   git push -u origin main
   ```

---

## 🚀 第二步：部署至雲端服務 (二選一)

推薦選用 **Glitch**，資料完全保留且不需修改程式碼！

### 方案 A：Glitch.com (強烈推薦，資料永久保留 🌟)
Glitch 提供免費的 Node.js 執行空間，最重要的是：**它的虛擬硬碟是持久的，您的玩家資料與帝國進度永遠不會遺失！**

1. 前往 [Glitch 官網](https://glitch.com/) 並註冊/登入帳號。
2. 點擊右上角 **「New Project」** 按鈕。
3. 在下拉選單最底部選擇 **「Import from GitHub」**。
4. **貼上您的 GitHub 專案 URL**：
   * 格式為：`https://github.com/【您的GitHub帳號】/【您的Repository名稱】`。
   * （如果是 Private 倉庫，Glitch 會提示您授權連結 GitHub）。
5. **點擊確認！** Glitch 將自動下載程式碼、安裝 Node.js 依賴並在背景自動啟動伺服器。
6. **獲取公網網址**：
   * 點擊 Glitch 編輯器下方的 **「Share」** 或 **「Preview」** 按鈕。
   * 複製 **「Live Site」** 的連結（例如 `https://empire-online.glitch.me`）。
   * **將這個網址傳給您的朋友們！** 所有人輸入這個網址就能一起在線註冊並在世界地圖中互相攻打！

---

### 方案 B：Render.com (現代雲端平台，但資料會因睡眠重置)
Render 是主流的雲端部署平台，完全免費，但因為免費容器有 15 分鐘無人使用會自動休眠的機制，休眠醒來後，`db.json` 會重置為您上傳時的空白狀態（玩家進度重啟會遺失，僅適合短期體驗或戰鬥演示）。

1. 前往 [Render 官網](https://render.com/) 註冊/登入帳號。
2. 在控制台點擊右上角 **「New +」**，選擇 **「Web Service」**。
3. 連結您的 GitHub 帳號，並在列表中找到您的 `empire-online` 倉庫，點擊 **「Connect」**。
4. **配置基本設定**：
   * **Name**: 您的服務名稱（例如 `empire-online`）。
   * **Region**: 保持預設即可（如 Oregon 或 Singapore）。
   * **Branch**: `main`。
   * **Runtime**: `Node`。
   * **Build Command**: `npm install`。
   * **Start Command**: `node server.js`。
   * **Instance Type**: 選擇 **Free**。
5. 點擊最下方的 **「Deploy Web Service」**。
6. 等待 2-3 分鐘部署完成，頁面左上方會生成一個專屬 HTTPS 連結（例如 `https://empire-online.onrender.com`）。打開連結即可開始聯網遊玩！

---

## 🎮 如何邀請多人一起同樂？

1. **分享您的網址**（例如 `https://your-game.glitch.me`）給您所有的朋友。
2. **每個人在自己設備的瀏覽器打開網址**。
3. **註冊各自的帝國帳號**：
   * 玩家 A 註冊 `EmpireA`，分配農民、木工，並募兵。
   * 玩家 B 在別的電腦/手機註冊 `EmpireB`，進行經營。
4. **聯網大戰**：
   * 當大家都註冊後，在「聯網世界地圖」和「排行榜」中將會實時顯示所有在線的玩家！
   * 任何人都可以徵召大軍，在世界地圖中對別的玩家發動突襲！防守方的瀏覽器會立刻響起震撼的**紅色防空警報雷達與 30 秒倒數計時**！
   * 所有戰鬥傷亡、掠奪物資與文字戰報，都是跨網路全球玩家實時同步的！

祝您的帝國戰無不勝，稱霸星辰！
