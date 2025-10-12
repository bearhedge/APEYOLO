# ApeX Options - Matrix-Inspired Trading Chat Interface Design Guidelines

## Design Approach
**Reference-Based: Matrix Movie Aesthetic**
Drawing from The Matrix's iconic cyber-noir visual language with cascading code, neon green phosphorescence, and digital dystopian atmosphere. Adapted for high-stakes options trading with real-time data visualization.

## Core Design Elements

### A. Color Palette
**Dark Mode (Primary)**
- Background Base: 0 0% 0% (pure black)
- Surface: 0 0% 5% (near-black panels)
- Primary Accent: 120 100% 50% (neon green #00FF00)
- Secondary Text: 0 0% 88% (light gray #E0E0E0)
- Cyber Highlights: 195 100% 50% (cyber blue #00BFFF)
- Success/Profit: 120 100% 50% (green)
- Danger/Loss: 0 100% 50% (red #FF0000)
- Grid Lines: 120 100% 25% (dark neon green, 20% opacity)

### B. Typography
**Font Stack**
- Headings/Branding: Orbitron Bold (700) / Medium (500) via Google Fonts
- Body Text: Inter 400/500/600 via Google Fonts
- Monospace/Data: Source Code Pro 400/500 via Google Fonts

**Type Scale**
- Hero/H1: text-5xl md:text-6xl font-bold (Orbitron)
- H2 Sections: text-3xl md:text-4xl font-bold (Orbitron)
- H3 Cards: text-xl font-medium (Orbitron)
- Body: text-sm md:text-base (Inter)
- Data/Numbers: text-base font-mono (Source Code Pro)
- Captions: text-xs text-gray-400

### C. Layout System
**Spacing Primitives**: Use Tailwind units of 2, 4, 6, 8, 12, 16 for consistent rhythm
- Component padding: p-4 to p-8
- Section spacing: py-12 to py-20
- Grid gaps: gap-4 to gap-6

**Container Strategy**
- Max-width: max-w-7xl for full layouts
- Chat container: max-w-4xl for optimal reading
- Sidebar panels: w-80 to w-96

### D. Component Library

**Navigation**
Fixed top navbar with glass-morphism effect: backdrop-blur-md bg-black/80 with neon green bottom border (border-b-2 border-[#00FF00])
- Logo: "ApeX Options" where "X" glows in neon green
- Nav links with neon green underline on hover
- Trading balance display in cyber blue
- User avatar with green glow ring

**Chat Interface (Primary)**
Three-column layout:
- Left sidebar (w-80): Watchlist with live prices, green/red indicators
- Center (flex-1): Chat messages with timestamps, monospace data, trading commands in green text
- Right sidebar (w-96): Order book, position summary, quick trade panel

**Message Cards**
- User messages: bg-zinc-900 with left green border-l-4
- System/Bot responses: bg-zinc-950 with cyber blue accents
- Trade confirmations: Neon green glow effect (shadow-[0_0_15px_rgba(0,255,0,0.3)])
- Timestamps: Source Code Pro, text-xs text-gray-500

**Trading Components**
- Price Cards: bg-zinc-900 border border-green-500/30 with live updating numbers in green
- Chart Widget: Dark canvas with cyber blue line charts, green volume bars, grid overlay
- Buy/Sell Buttons: Neon green (buy) with glow hover, red (sell) with pulse effect
- Input Fields: bg-black border-2 border-green-500/50, focus:border-green-500 glow

**Data Displays**
- Position Grid: 3-4 columns showing strike, expiry, P&L with color coding
- Order Book: Two-column bid/ask with green/red text, monospace alignment
- Real-time Ticker: Horizontal scrolling strip with green numbers

### E. Animations

**Matrix Code Background**
Subtle falling green characters animation (opacity 10%) covering entire viewport, positioned fixed behind all content, using canvas or CSS animation

**Interactive Effects**
- Button hovers: Neon green glow intensifies (shadow spread from 10px to 20px)
- Card hovers: Subtle lift with green border brightening
- Data updates: Brief green flash on price changes
- Loading states: Pulsing green dots in Source Code Pro

**Scroll Behavior**
Smooth scroll, navbar gains stronger backdrop blur on scroll

## Images

**Hero Section Image**
Full-width background image (1920x800px): Digital Matrix rain effect or abstract circuit board with neon green traces on black background. Apply dark overlay (bg-black/60) for text readability.

**Additional Graphics**
- Trading chart backgrounds: Dark grid patterns with subtle green glow
- Avatar placeholders: Circular frames with green neon rings
- Empty states: Matrix code snippets as decorative elements

## Layout Specifications

**Hero Section** (h-screen)
Full viewport height with Matrix rain background image, centered content:
- "ApeX Options" title (text-6xl Orbitron) with glowing X
- Tagline in Inter with cyber blue accent
- Primary CTA: "Start Trading" button with neon green glow
- Live market ticker strip at bottom

**Main Trading Interface**
Three-panel dashboard layout below hero:
- Sticky header with balance, positions summary
- Chat feed in center with infinite scroll
- Collapsible sidebars for mobile (drawer pattern)
- Footer with risk disclaimer in Source Code Pro

**Responsive Strategy**
- Desktop: Three-column layout maintained
- Tablet: Stack right sidebar below chat
- Mobile: Hamburger navigation, single column, bottom sheet for quick trades