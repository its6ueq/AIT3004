# frontend/Dockerfile

# THAY ĐỔI DÒNG NÀY
FROM node:20-slim
# TỪ: FROM node:18-alpine

# Các dòng còn lại giữ nguyên
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]