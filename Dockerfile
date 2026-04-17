FROM node:20-alpine AS build
WORKDIR /app

# Accept build arguments
ARG VITE_API_URL
ARG VITE_YANDEX_API_KEY
ARG VITE_YANDEX_MAPS_API_KEY

# Set them as environment variables for the build process
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_YANDEX_API_KEY=$VITE_YANDEX_API_KEY
ENV VITE_YANDEX_MAPS_API_KEY=$VITE_YANDEX_MAPS_API_KEY

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

