# Rental Management System

A comprehensive rental property management application built with Next.js, TypeScript, and Tailwind CSS.

## Features

### 🏠 Dashboard
- Property metrics overview
- Monthly income tracking
- Late payments monitoring
- Property type breakdown
- Quick actions and search

### 🏢 Properties Management
- Add, edit, and delete properties
- Property details (address, bedrooms, bathrooms, etc.)
- Property type categorization (house, doublewide, singlewide, loan)
- Rent amount tracking
- Availability status

### 👥 Tenants Management
- Add, edit, and delete tenants
- Contact information (phone, email)
- Lease period tracking
- Active/inactive status
- Search and filtering

### 📄 Leases Management
- Create and manage rental leases
- Link tenants to properties
- Rent amount and cadence (weekly, biweekly, monthly)
- Lease start/end dates
- Status tracking (active, inactive, terminated)

### 💰 Payments Grid
- Friday-based rent status matrix
- Rows = leases/properties, Columns = Fridays
- Total owed calculations
- Period status tracking (paid, partial, late, due)
- Double-click to update periods
- Cadence-based active periods

### ⚠️ Late Tenants
- Overdue payment tracking
- Days late calculations
- Late fee management
- Contact actions (call, text, email)
- Payment recording
- Late fee waiving

### 📊 Profit Analysis
- Income vs expenses tracking
- NOI (Net Operating Income) calculations
- Cash flow analysis
- Collection rate monitoring
- Property performance metrics
- Export capabilities

## Database Schema

The application uses the following existing RENT_ tables:

- **RENT_properties**: Property information
- **RENT_tenants**: Tenant details
- **RENT_leases**: Lease agreements
- **RENT_rent_periods**: Rent period tracking
- **RENT_payments**: Payment records
- **RENT_payment_allocations**: Payment allocations

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Supabase account and project

### Installation

1. Clone the repository:
```bash
cd C:\Projects\rental-app-v2
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp env.example .env.local
```

4. Update `.env.local` with your Supabase credentials:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

5. Run the development server:
```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
src/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   │   └── rent/
│   │       └── payments/
│   │           └── grid/  # Payments grid API
│   ├── dashboard/         # Dashboard page
│   ├── properties/        # Properties management
│   ├── tenants/          # Tenants management
│   ├── leases/           # Leases management
│   ├── payments/         # Payments grid
│   ├── late-tenants/     # Late tenants tracking
│   ├── profit/           # Profit analysis
│   └── layout.tsx        # Root layout
├── components/            # Reusable components
│   └── Navigation.tsx    # Main navigation
├── lib/                  # Utility libraries
│   └── supabase.ts      # Supabase client
└── types/               # TypeScript type definitions
    └── database.ts      # Database types
```

## Key Features Implementation

### Payments Grid Logic
- **Friday Matrix**: Generates consecutive Fridays for 16-week window
- **Cadence Handling**: 
  - Weekly: Every Friday is active
  - Biweekly: Every other Friday is active
  - Monthly: One Friday per month is active
- **Total Owed Calculation**: Sum of open periods with due dates ≤ today
- **Late Fee Logic**: Flat fees based on cadence (Monthly: $45, Bi-weekly: $25, Weekly: $12)

### Late Tenants Logic
- **Days Late**: Calculated from latest overdue period
- **Late Periods Count**: Number of open late periods
- **Total Owed (Late)**: Sum of late periods only
- **Contact Actions**: Direct phone, text, and email integration

### Profit Analysis Logic
- **EGI**: Gross Collected (Rent + Late Fees + Other Income)
- **NOI**: EGI - Operating Expenses
- **CFAD**: NOI - Debt Service
- **Collection Rate**: Rent Collected ÷ Scheduled Rent
- **Late Fee Yield**: Late Fees Collected ÷ Rent Collected

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

### Adding New Features

1. Create new page in `src/app/[feature]/page.tsx`
2. Add navigation item in `src/components/Navigation.tsx`
3. Create API routes in `src/app/api/`
4. Update types in `src/types/database.ts`

## Deployment

The application is ready for deployment on platforms like Vercel, Netlify, or any Node.js hosting service.

1. Build the application:
```bash
npm run build
```

2. Deploy the `out` directory to your hosting platform.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is private and proprietary.