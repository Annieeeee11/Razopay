FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests

CMD ["npm", "run", "reconcile", "--", "--seed", "42", "--skip-llm"]
