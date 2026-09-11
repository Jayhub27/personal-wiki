FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3210
EXPOSE 3210

VOLUME ["/app/content", "/app/public/uploads"]

CMD ["node", "server.js"]
