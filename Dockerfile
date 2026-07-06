# ==========================================
# STAGE 1: Build Vite React Frontend
# ==========================================
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ==========================================
# STAGE 2: Build Node.js Backend & Package App
# ==========================================
FROM node:18-alpine
WORKDIR /app

# Install production dependencies for backend
COPY backend/package*.json ./backend/
RUN npm install --prefix backend --omit=dev

# Copy backend source code
COPY backend/ ./backend/

# Copy built frontend assets from Stage 1 into the location backend serves
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose production port
EXPOSE 8081

# Set production variables
ENV NODE_ENV=production
ENV PORT=8081

# Run Express server
CMD ["npm", "start", "--prefix", "backend"]
