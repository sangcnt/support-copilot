ARG NODE_VERSION=24.18.0
FROM node:${NODE_VERSION}-alpine AS frontend-build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

ARG FRONTEND_PUBLIC_BASE=/demo/support-copilot/
ENV VITE_PUBLIC_BASE=${FRONTEND_PUBLIC_BASE}

RUN npm run build

FROM nginx:1.29-alpine

COPY infrastructure/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/dist /usr/share/nginx/html
