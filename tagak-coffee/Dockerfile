FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build
RUN mkdir -p server/uploads/carousel server/uploads/menu

EXPOSE 3000

# Apply schema, create the Super Admin, then start the web server.
CMD ["sh", "-c", "node db/migrate.js && node db/seed.js && node server.js"]
