# VooSquare: zero npm dependencies, Node 22 built-ins only.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY . .
# Railway mounts a volume at /data (see README). The database lives there.
RUN mkdir -p /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
