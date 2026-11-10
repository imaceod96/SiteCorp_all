FROM node:20-alpine

WORKDIR /app/services/auth-api

RUN apk add --no-cache libc6-compat wget

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig*.json ./
COPY src ./src
COPY db ./db
COPY scripts ./scripts

RUN npx tsc -p tsconfig.build.json --noEmit

RUN mkdir -p /var/lib/sitecorp/storage && chown -R node:node /var/lib/sitecorp/storage /app/services/auth-api

USER node

EXPOSE 4010

CMD ["npm", "run", "start"]
