# --- Stage 1: build the Vue frontend ---
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY clickup-app/frontend/package*.json ./
RUN npm ci
COPY clickup-app/frontend/ ./
# No VITE_API_URL at build time -> frontend uses same-origin API paths
RUN npm run build

# --- Stage 2: runtime with pdflatex ---
FROM node:22-bookworm-slim

# TeX Live packages covering the template's needs
# (geometry, tabularx, xcolor, ltablex, booktabs, hyperref)
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-latex-extra \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY clickup-app/backend/package*.json ./
RUN npm ci --omit=dev
COPY clickup-app/backend/ ./
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
