FROM node:22-alpine

WORKDIR /app/apps/api

COPY apps/api/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=20000

COPY apps/api/prisma ./prisma
RUN npm run prisma:generate

COPY apps/api/ ./
RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push && node dist/main.js"]
