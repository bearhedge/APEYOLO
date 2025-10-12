# ApeX Options

![Matrix-Inspired Trading Platform](https://img.shields.io/badge/Status-Active-00FF00?style=for-the-badge)
![Built with React](https://img.shields.io/badge/React-TypeScript-00BFFF?style=for-the-badge&logo=react)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-00FF00?style=for-the-badge&logo=tailwindcss)

**At the Apex of Options Trading – where discipline meets tribe.**

ApeX Options is a Matrix-inspired options trading platform skeleton featuring a futuristic design with neon aesthetic, built for speed and scalability. This agentic chat interface combines cutting-edge UI/UX with powerful trading capabilities.

## 🎯 Features

- **Agentic Chat Interface**: Natural language trading commands
- **Matrix Theme**: Neon green glowing effects, falling code animation
- **Real-time Data**: Live market updates and position tracking
- **Dark Mode**: Pure black background with cyber aesthetics
- **Responsive Design**: Optimized for desktop and mobile

## 🚀 Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS with custom Matrix theme
- **Typography**: Orbitron (headings), Inter (body), Source Code Pro (monospace)
- **UI Components**: shadcn/ui with Radix primitives
- **State Management**: TanStack Query
- **Backend**: Node.js + Express + PostgreSQL

## 💚 Color Palette

- **Background**: `#000000` (Pure Black)
- **Primary Accent**: `#00FF00` (Neon Green)
- **Secondary Accent**: `#E0E0E0` (Light Gray)
- **Cyber Highlight**: `#00BFFF` (Cyber Blue)
- **Destructive**: `#FF0000` (Red)

## 🛠️ Setup Instructions

### Prerequisites

- Node.js 18+ 
- npm or yarn
- PostgreSQL (for production)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd apex-options
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
apex-options/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/    # UI components
│   │   │   └── ChatWindow.tsx
│   │   ├── lib/          # Utilities
│   │   └── index.css     # Matrix theme styles
│   └── index.html        # HTML entry point
├── server/                # Express backend
│   ├── routes.ts         # API routes
│   └── index.ts          # Server entry
├── shared/               # Shared types
└── legacy_backup_*/      # Previous versions
```

## 🎨 Design Philosophy

ApeX Options embraces the **Matrix aesthetic** with:
- **Neon green glowing effects** on interactive elements
- **Falling code animation** in the background (low opacity)
- **Cyber-noir color palette** (black, neon green, cyber blue)
- **Orbitron font** for futuristic branding
- **Grid-based layouts** with subtle neon borders

## 🔧 Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run db:push` - Sync database schema

### Key Components

- **ChatWindow**: Main agentic interface with Matrix theme
- **MatrixRain**: Falling code background animation
- **Sidebar Navigation**: Sessions, Positions, P&L, Settings

## 📝 Branding

The **ApeX** logo features:
- "Ape" in standard Orbitron font
- "**X**" highlighted in neon green (`#00FF00`) with glow effect
- "Options" in standard Orbitron font

Tagline: _"At the Apex of Options Trading – where discipline meets tribe."_

## 🌐 Future Enhancements

- [ ] AI-powered trade recommendations
- [ ] Advanced charting with TradingView integration
- [ ] Multi-user chat and collaboration
- [ ] Mobile app (React Native)
- [ ] Algorithmic trading integration

## 📄 License

MIT License - See LICENSE file for details

## 🤝 Contributing

Contributions welcome! Please read CONTRIBUTING.md first.

---

**Built with 💚 in the Matrix**
