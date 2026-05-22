FROM node:20-slim

WORKDIR /app

# 複製設定檔並安裝依賴
COPY package*.json ./
RUN npm install --production

# 複製所有專案檔案
COPY . .

# 暴露連接埠 (Hugging Face 會自動在環境變數傳入 PORT，預設通常是 7860)
EXPOSE 7860

# 啟動伺服器
CMD ["node", "server.js"]
