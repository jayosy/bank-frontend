# syntax=docker/dockerfile:1

FROM nginx:1.30.4-alpine

ARG APP_VERSION=0.0.0
ARG GIT_COMMIT=unknown
ARG BUILD_DATE=unknown

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY dist/bank-front/browser/ /usr/share/nginx/html/

EXPOSE 8080

LABEL org.opencontainers.image.title="bank-front" \
      org.opencontainers.image.description="Angular frontend for Bank Platform Lab" \
      org.opencontainers.image.vendor="Bank Platform Lab" \
      org.opencontainers.image.source="https://github.com/jayosy/bank-frontend" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}"