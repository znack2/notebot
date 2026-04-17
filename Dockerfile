# base image
FROM node:18

# рабочая директория
WORKDIR /app

# копируем зависимости
COPY package*.json ./

# устанавливаем зависимости
RUN npm install

# копируем код
COPY . .

# порт
EXPOSE 3000

# запуск
CMD ["node", "index.js"]