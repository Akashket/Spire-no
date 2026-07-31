# Enkel dev-orientert Dockerfile (ikke multi-stage optimalisert for produksjon ennå -
# det tar vi når appen faktisk skal driftes et sted).
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate

EXPOSE 3001

CMD ["npm", "run", "start:dev"]
