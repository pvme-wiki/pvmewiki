FROM node:24-bookworm-slim
WORKDIR /app
COPY article.css copy.js favicon.svg compare.html ./
COPY userspace/server.mjs userspace/stage.css userspace/content.json.gz ./userspace/
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "userspace/server.mjs"]
