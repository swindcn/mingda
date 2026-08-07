FROM node:22-alpine

WORKDIR /app/apps/api

COPY apps/api/package*.json ./
RUN npm ci

COPY apps/api/prisma ./prisma
RUN npm run prisma:generate

COPY apps/api/ ./
RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push && node dist/main.js"]
