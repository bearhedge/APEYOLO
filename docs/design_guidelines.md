# APEYOLO Design Guidelines

## Brand Identity
**APEYOLO** - "THE SAFEST WAY TO YOLO."

## Design Philosophy
APEYOLO embraces a **monochrome professional aesthetic** with clean lines, subtle shadows, and hairline borders. The design prioritizes clarity, readability, and a premium trading experience.

## Color Palette

### Monochrome Scale
- **Pure Black**: `#000000` - Main background
- **Charcoal**: `#0B0B0B` - Card backgrounds
- **Dark Gray**: `#1A1A1A` - Hover states, secondary backgrounds
- **Mid Gray**: `#2B2B2B` - Borders, dividers
- **Silver**: `#A6A6A6` - Secondary text, muted elements
- **White**: `#FFFFFF` - Primary text, headings

### Status Colors
- **Success/Positive**: `#10B981` (Green) - Profits, gains, active status
- **Destructive/Negative**: `#EF4444` (Red) - Losses, errors, warnings
- **Info/Neutral**: `#3B82F6` (Blue) - Information, links
- **Warning**: `#F59E0B` (Amber) - Cautions, pending states

### Opacity Modifiers
- **Borders**: `rgba(255, 255, 255, 0.1)` - Hairline borders (border-white/10)
- **Shadows**: Subtle, layered shadows for depth
- **Hover**: Slightly lighter backgrounds (#1A1A1A)

## Typography

### Font Family
- **Primary Font**: `Century Gothic` - Used for ALL text throughout the application
- System font stack: `'Century Gothic', 'CenturyGothic', 'AppleGothic', sans-serif`

### Text Hierarchy
- **Headings (H1)**: Century Gothic Bold, 2xl-3xl
- **Headings (H2)**: Century Gothic SemiBold, xl-2xl
- **Headings (H3)**: Century Gothic Medium, lg-xl
- **Body Text**: Century Gothic Regular, sm-base
- **Small Text**: Century Gothic Regular, xs-sm
- **Numbers/Data**: Century Gothic Medium, tabular-nums

## Layout & Spacing

### Container Widths
- **Max Width**: `max-w-7xl` (1280px)
- **Padding**: Consistent `p-6` on cards and sections
- **Gaps**: `gap-6` between grid items and cards

### Grid System
- **Dashboard**: 3 columns on large screens (`lg:grid-cols-3`)
- **Responsive**: Stack to single column on mobile
- **Card Spacing**: `space-y-6` for vertical stacking

### Border Radius
- **Cards**: `rounded-2xl` (16px)
- **Buttons**: `rounded-lg` (8px)
- **Inputs**: `rounded-md` (6px)
- **Small Elements**: `rounded` (4px)

## Components

### Cards
```tsx
className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg"
```
- Background: Charcoal (#0B0B0B)
- Border: 1px hairline (border-white/10)
- Padding: p-6
- Rounded corners: rounded-2xl
- Subtle shadow

### Buttons
**Primary Button**:
```tsx
className="bg-white text-black px-4 py-2 rounded-lg font-medium hover:bg-silver transition-colors"
```

**Secondary Button**:
```tsx
className="bg-mid-gray text-white px-4 py-2 rounded-lg font-medium hover:bg-dark-gray transition-colors"
```

**Destructive Button**:
```tsx
className="bg-red-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-600 transition-colors"
```

### Tables
- **Header**: Dark gray background, silver text, font-medium
- **Rows**: Hover state with dark-gray background
- **Borders**: Hairline borders (border-white/10)
- **Padding**: px-4 py-3 for cells
- **Font**: Century Gothic Regular, tabular-nums for numbers

### Forms
- **Input**: Dark gray background, white text, hairline border
- **Focus State**: White border, subtle glow
- **Label**: Silver text, font-medium, mb-2
- **Select**: Matches input styling

### Status Indicators
- **Online/Active**: Green dot + text
- **Offline/Inactive**: Red dot + text
- **Pending**: Amber dot + text
- **Badge**: Rounded-full px-2 py-1 text-xs

## Navigation

### Navbar
- **Position**: Sticky top-0
- **Background**: Black with border-bottom (border-white/10)
- **Height**: h-16
- **Items**: Century Gothic Medium, hover:text-white transition
- **Active**: White text with underline
- **Status Indicator**: Tiny green dot + "ONLINE" text (right side)

### Pages
- **Sessions**: Chat/command interface
- **Dashboard**: Main trading overview (3-column grid)
- **PNL**: Track record (immutable table)
- **Settings**: Configuration sections

## Dashboard Specific

### Cards Layout
1. **Open Positions**: Full-width table with columns (symbol, side, qty, avg, mark, upl, IV, delta, theta, margin, time)
2. **Leverage & NAV**: NAV display, cash, margin available, current leverage (big number), 30-day sparkline
3. **Withdrawals**: Latest withdrawals table (date, amount, status) + link
4. **Historical Positions**: Compact table (status, realized P/L, holding period)

### Execute Trade Button
- **Position**: Top right of Dashboard
- **Style**: Primary button with icon
- **Action**: Opens modal with ticker, strategy, qty fields

## PNL (Track Record)

### Table Columns
- Trade ID, Timestamp, Symbol, Strategy, Side, Qty, Entry, Exit, Fees, Realized P/L, Run P/L, Notes
- **Read-only**: No edit controls
- **Immutable**: Server-provided data only

### Toolbar Features
- Date range picker
- Symbol filter
- Export buttons (CSV, JSON)
- **Record Hash**: Display SHA-256 hash of current export
- **Format**: `"Record hash: abc123..."`

## Settings Sections

### 1. Broker Connection (IBKR OAuth2)
- **Fields**: Client ID, Key ID, Account (masked) - read-only
- **Status Badges**: OAuth 2.0, SSO, Brokerage Session (color-coded)
- **Actions**: 6 buttons (Request OAuth Token, Create SSO Session, Validate SSO, Init Brokerage Session, Tickle, Logout)
- **Response Display**: Last response code + traceId

### 2. Risk & Automation
- **Aggression Slider**: Conservative ↔ Aggressive
- **Limits**: Max leverage, Per-trade risk %, Daily loss limit, Max positions, Max notional
- **Toggles**: Auto-roll, Auto-hedge, Market hours only, Circuit breaker

### 3. Agent (OpenAI SDK)
- **Model Selector**: Dropdown
- **API Key**: Masked input
- **System Prompt**: Textarea
- **Strategy Presets**: Wheel, Covered Calls, Cash-Secured Puts
- **Safety Rails**: Ban lists, min liquidity, min premium

### 4. Notifications & Webhooks
- **Channels**: Email, Slack, Webhook URLs
- **Toggles**: Fills, Errors, Risk breaches, Daily summary

### 5. General
- **Preferences**: Base currency, Timezone, Number format
- **Theme**: Monochrome only

## Animations & Interactions

### Hover Effects
- Slight background color change (to #1A1A1A)
- Smooth transition (transition-colors duration-200)
- No glow effects or neon

### Loading States
- Skeleton screens with pulsing gray backgrounds
- Spinner with white color
- Loading text: "Loading..."

### Transitions
- **Duration**: 200ms for most interactions
- **Easing**: ease-in-out
- **Properties**: colors, opacity, transform

## Accessibility

- High contrast text (white on black)
- Sufficient color differentiation for status colors
- Focus states with visible outlines
- Keyboard navigation support
- ARIA labels on interactive elements
- data-testid attributes for testing

## Responsive Design

### Breakpoints
- **Mobile**: < 640px (stack all columns)
- **Tablet**: 640px - 1024px (2-column grid)
- **Desktop**: > 1024px (3-column grid)

### Mobile Adjustments
- Reduce padding to p-4
- Stack tables vertically
- Collapsible sections for settings
- Touch-friendly button sizes (min 44px)

## Do's and Don'ts

### Do:
✅ Use Century Gothic for all text
✅ Maintain monochrome palette
✅ Apply 1px hairline borders (border-white/10)
✅ Use rounded-2xl for cards
✅ Keep consistent p-6 padding and gap-6 spacing
✅ Show subtle shadows for depth
✅ Use tabular-nums for financial data

### Don't:
❌ Use neon colors or glowing effects
❌ Add Matrix rain or animated backgrounds
❌ Mix other font families
❌ Use heavy borders or outlines
❌ Apply gradients or patterns
❌ Use emoji or decorative icons excessively
