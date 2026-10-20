# PNW Payroll Tax Engine

Julia-based federal payroll tax computation service for the PNW Employment Portal.

## What It Computes

For each pay period, the engine uses the **IRS annualization method** (Publication 15-T):

1. Projects per-period gross to annual income
2. Applies the standard deduction for the filing status
3. Computes marginal federal income tax on projected taxable income
4. Computes Social Security tax (6.2% up to the wage base cap, tracking YTD)
5. Computes Medicare tax (1.45% + 0.9% additional above threshold)
6. De-annualizes all taxes back to per-period amounts

This means the tax brackets **auto-adjust based on projected annual income** — a $25/hr worker on weekly pay has tax computed as if they earn $52,000/year, using the correct marginal bracket from the first paycheck.

## API

**`POST /compute`**
```json
{
  "gross": 1000.00,
  "filing_status": "single",
  "pay_period": "biweekly",
  "ytd_gross": 26000.00,
  "ytd_ss_tax": 1612.00
}
```

**Response:**
```json
{
  "gross_per_period": 1000.00,
  "federal_income_tax": 95.38,
  "social_security_tax": 62.00,
  "medicare_tax": 14.50,
  "additional_medicare_tax": 0.00,
  "total_fica": 76.50,
  "total_tax": 171.88,
  "net_pay": 828.12,
  "projected_annual_gross": 26000.00,
  "marginal_bracket_rate": 0.12,
  "effective_total_rate": 0.1719,
  "tax_year": 2026
}
```

## Tax Tables

Tax bracket data lives in `tax_tables/federal_2026.json` — a standalone JSON config that can be updated without touching the engine code. When the IRS publishes final 2026 brackets (Revenue Procedure), update this file.

## Running

```bash
# Local
julia --project=. -e 'using Pkg; Pkg.instantiate()'
julia --project=. src/server.jl

# Docker
docker build -t pnw-tax-engine .
docker run -p 8787:8787 pnw-tax-engine
```

The portal calls this service via a Next.js API route at `app/api/compute-tax/route.ts`.

## Privacy

The engine receives ONLY financial amounts and jurisdiction codes — no names, addresses, wallet keys, or identity data. It is a pure stateless computation service.

## Filing Statuses

| Status | Key |
|---|---|
| Single | `single` |
| Married Filing Jointly | `married_filing_jointly` |
| Married Filing Separately | `married_filing_separately` |
| Head of Household | `head_of_household` |

## Pay Periods

| Period | Key | Periods/Year |
|---|---|---|
| Daily | `daily` | 260 |
| Weekly | `weekly` | 52 |
| Bi-weekly | `biweekly` | 26 |
| Semi-monthly | `semimonthly` | 24 |
| Monthly | `monthly` | 12 |
| Quarterly | `quarterly` | 4 |
