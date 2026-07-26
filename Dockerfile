# syntax=docker/dockerfile:1

FROM nginx:1.30.4-alpine

LABEL org.opencontainers.image.title="bank-front"
LABEL org.opencontainers.image.description="Angular frontend for Bank Platform Lab"
LABEL org.opencontainers.image.vendor="Bank Platform Lab"

COPY nginx/default.conf /etc/nginx/conf.d/default.conf

COPY dist/bank-front/browser/ /usr/share/nginx/html/

EXPOSE 8080
