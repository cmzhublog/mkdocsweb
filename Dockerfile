FROM node:24-alpine AS frontend
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY index.html tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM golang:1.26.11-alpine AS backend
WORKDIR /build
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /mkdocsweb .

FROM backend AS test
RUN apk add --no-cache gcc musl-dev
ENTRYPOINT ["go", "test", "-race", "./..."]

FROM alpine:3.23
RUN apk add --no-cache ca-certificates && addgroup -g 10001 app && adduser -D -u 10001 -G app app && mkdir -p /data && chown app:app /data
WORKDIR /app
COPY --from=backend /mkdocsweb /app/mkdocsweb
COPY --from=frontend /build/dist /app/dist
USER app
ENV DATA_FILE=/data/mkdocsweb.db STATIC_DIR=/app/dist LISTEN_ADDR=0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["/app/mkdocsweb"]
