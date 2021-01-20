FROM node:14-alpine

WORKDIR /app

COPY package.json .

RUN npm install

COPY Exporter Exporter
COPY exporter.js .

RUN adduser -S -u 2000 appuser
USER appuser

ENTRYPOINT npm start