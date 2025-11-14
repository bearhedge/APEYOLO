# APEYOLO

![Professional Trading Platform](https://img.shields.io/badge/Status-Active-00FF00?style=for-the-badge)
![Built with React](https://img.shields.io/badge/React-TypeScript-000000?style=for-the-badge&logo=react)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-000000?style=for-the-badge&logo=tailwindcss)

**THE SAFEST WAY TO YOLO.**

APEYOLO is a professional options trading platform featuring a clean monochrome design, AI-powered automation, and institutional-grade risk management. Built for systematic traders who value precision and control.

## 🎯 Features

- **AI-Powered Agent**: AI driven decision making with customizable strategies
- **Risk Management**: Configurable limits, circuit breakers, and automated position management
- **Immutable Audit Trail**: Cryptographic SHA-256 hashing for compliance and verification
- **Real-time Execution**: Direct IBKR integration with sub-second order placement
- **Clean Monochrome Design**: Professional aesthetic with Century Gothic typography

## 🚀 Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS with monochrome theme
- **Typography**: Century Gothic (all text)
- **UI Components**: shadcn/ui with Radix primitives
- **State Management**: TanStack Query + Zustand
- **Backend**: Node.js + Express + PostgreSQL

## 🎨 Color Palette

- **Background**: `#000000` (Pure Black)
- **Charcoal**: `#0B0B0B` (Card backgrounds)
- **Dark Gray**: `#1A1A1A` (Hover states)
- **Mid Gray**: `#2B2B2B` (Borders)
- **Silver**: `#A6A6A6` (Secondary text)
- **White**: `#FFFFFF` (Primary text)

## 🛠️ Setup Instructions

### Prerequisites

- Node.js 18+ 
- npm or yarn
- PostgreSQL (for production)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd apeyolo
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Configure your DATABASE_URL and other secrets
   ```

4. **Run development server**
   ```bash
   npm run dev
   ```

5. **Open in browser**
   ```
   http://localhost:5000
   ```

## 📁 Project Structure

```
apeyolo/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/    # UI components
│   │   ├── pages/         # Page components
│   │   ├── lib/          # Utilities & API
│   │   └── index.css     # Monochrome theme styles
│   └── index.html        # HTML entry point
├── server/                # Express backend
│   ├── routes.ts         # API routes
│   └── index.ts          # Server entry
├── shared/               # Shared types
└── design_guidelines.md  # Design system documentation
```

## 🎨 Design Philosophy

APEYOLO embraces a **monochrome professional aesthetic** with:
- **Clean black/white/grey palette** for clarity and focus
- **Century Gothic typography** for modern, readable text
- **Hairline borders** (1px rgba(255,255,255,0.1)) for subtle definition
- **Minimal animations** - focus on functionality over flash
- **Professional trading aesthetic** that prioritizes usability

## 🔧 Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run db:push` - Sync database schema

### Core Pages

- **Dashboard**: Open positions, leverage, NAV, withdrawals (open + historical)
- **PNL (Track Record)**: Immutable trade history with SHA-256 hashing
- **Settings**: IBKR OAuth2 connection, risk preferences (aggression slider, leverage cap, max loss/day)
- **Sessions**: Agentic chat interface for natural language trading commands
- **Onboarding**: 3-step flow (Google login, IBKR connection, risk preferences)

## 📝 Branding

**APEYOLO** - "THE SAFEST WAY TO YOLO."

The brand emphasizes:
- Professional, systematic approach to options trading
- AI-powered automation with human oversight
- Institutional-grade risk management for retail traders
- Clean, minimal design that focuses on data and functionality

## 🌐 Future Enhancements

- [ ] Blockchain anchoring for immutable P&L records
- [ ] Advanced AI strategy customization
- [ ] Multi-broker support
- [ ] Mobile app (React Native)
- [ ] Real-time collaboration features

## 📄 License

MIT License - See LICENSE file for details

## 🤝 Contributing

Contributions welcome! Please read CONTRIBUTING.md first.

---

**Built for traders who understand that the safest YOLO is a calculated one.**

---

## ☁️ Deploy (GCP Cloud Run)

This repo includes a Dockerfile and Cloud Build config to deploy the app to Cloud Run with CI/CD and map a custom domain (e.g., `app.apeyolo.com`).

Prerequisites
- gcloud CLI installed and authenticated
- A GCP project (PROJECT_ID)
- DNS access for your domain

Bootstrap (one‑time)
1. export PROJECT_ID=your-gcp-project
2. bash scripts/gcp_bootstrap.sh
   - Enables APIs, builds Docker image via Cloud Build, deploys to Cloud Run.
   - Prints the temporary Cloud Run URL when done.

Custom Domain (managed TLS)
1. export PROJECT_ID=your-gcp-project
2. export DOMAIN=app.apeyolo.com  # optional; defaults to app.apeyolo.com
3. bash scripts/map_domain.sh
4. Add the printed DNS records at your DNS host; wait for propagation

CI/CD Trigger (GitHub)
Run once to enable automatic deploys from pushes to `main`:

gcloud builds triggers create github \
  --name=apeyolo-deploy \
  --repo-owner=YOUR_GH_USER --repo-name=YOUR_REPO \
  --branch-pattern=^main$ --build-config=cloudbuild.yaml

Notes
- Cloud Run listens on the `PORT` env var; the server uses it automatically.
- Build uses the included Dockerfile; runtime command is `node dist/index.js`.
- Ensure production env variables are set in your Cloud Run service as needed.
