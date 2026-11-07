FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV QD_CLOUD=1
COPY . .
EXPOSE 8787
# No credentials or trading state are baked into the image.
# Supply runtime config via a private volume/secret at deployment time.
CMD ["node", "server.js"]
