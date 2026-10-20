"""
    PNW Payroll Tax Engine

Federal payroll tax computation using the IRS annualization method
(Publication 15-T). For each pay period, the engine:

  1. Projects the per-period gross to an annual amount
  2. Applies the standard deduction for the filing status
  3. Computes marginal federal income tax on the projected annual taxable income
  4. Computes Social Security tax (6.2% up to the wage base cap)
  5. Computes Medicare tax (1.45% + 0.9% additional above threshold)
  6. Divides everything back to per-period amounts

Tax tables are loaded from a JSON config file so they can be updated
without touching the engine code when the IRS publishes new brackets.

Privacy: This engine receives ONLY financial amounts and jurisdiction
codes — no names, addresses, or identity data. It is a pure computation
service.
"""
module TaxEngine

using JSON

export FilingStatus, PayPeriod, TaxInput, TaxResult
export compute_payroll_tax, load_tax_tables!

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@enum FilingStatus begin
    SINGLE
    MARRIED_FILING_JOINTLY
    MARRIED_FILING_SEPARATELY
    HEAD_OF_HOUSEHOLD
end

@enum PayPeriod begin
    DAILY
    WEEKLY
    BIWEEKLY
    SEMIMONTHLY
    MONTHLY
    QUARTERLY
end

"""Input to the tax computation engine."""
struct TaxInput
    gross_per_period::Float64       # Gross pay for THIS pay period
    filing_status::FilingStatus
    pay_period::PayPeriod
    ytd_gross::Float64              # Year-to-date gross (for SS cap tracking)
    ytd_ss_tax::Float64             # Year-to-date SS tax already withheld
end

"""Comprehensive tax computation result for a single pay period."""
struct TaxResult
    # Input echo
    gross_per_period::Float64
    filing_status::FilingStatus
    pay_period::PayPeriod

    # Projected annual values (for bracket determination)
    projected_annual_gross::Float64
    standard_deduction::Float64
    projected_taxable_income::Float64

    # Per-period tax amounts
    federal_income_tax::Float64
    social_security_tax::Float64
    medicare_tax::Float64
    additional_medicare_tax::Float64
    total_fica::Float64
    total_tax::Float64
    net_pay::Float64

    # Effective rates
    effective_federal_rate::Float64
    effective_total_rate::Float64

    # Marginal bracket info
    marginal_bracket_rate::Float64
end

# ---------------------------------------------------------------------------
# Tax table storage (loaded from JSON)
# ---------------------------------------------------------------------------

struct Bracket
    rate::Float64
    min::Float64
    max::Float64  # Inf for the top bracket
end

mutable struct TaxTables
    tax_year::Int
    ss_rate::Float64
    ss_wage_base::Float64
    medicare_rate::Float64
    additional_medicare_rate::Float64
    additional_medicare_thresholds::Dict{FilingStatus, Float64}
    standard_deductions::Dict{FilingStatus, Float64}
    brackets::Dict{FilingStatus, Vector{Bracket}}
    periods_per_year::Dict{PayPeriod, Int}
    loaded::Bool
end

# Global tables instance
const TABLES = TaxTables(
    0, 0.0, 0.0, 0.0, 0.0,
    Dict(), Dict(), Dict(), Dict(), false
)

# ---------------------------------------------------------------------------
# Filing status string mapping
# ---------------------------------------------------------------------------

const FILING_STATUS_KEYS = Dict(
    "single" => SINGLE,
    "married_filing_jointly" => MARRIED_FILING_JOINTLY,
    "married_filing_separately" => MARRIED_FILING_SEPARATELY,
    "head_of_household" => HEAD_OF_HOUSEHOLD,
)

const PAY_PERIOD_KEYS = Dict(
    "daily" => DAILY,
    "weekly" => WEEKLY,
    "biweekly" => BIWEEKLY,
    "semimonthly" => SEMIMONTHLY,
    "monthly" => MONTHLY,
    "quarterly" => QUARTERLY,
)

# ---------------------------------------------------------------------------
# Load tax tables from JSON
# ---------------------------------------------------------------------------

"""
    load_tax_tables!(path::String)

Load tax bracket data from a JSON config file. Call this once at startup.
The JSON format matches `tax_tables/federal_2026.json`.
"""
function load_tax_tables!(path::String)
    data = JSON.parsefile(path)

    TABLES.tax_year = data["tax_year"]
    TABLES.ss_rate = data["social_security"]["rate"]
    TABLES.ss_wage_base = data["social_security"]["wage_base"]
    TABLES.medicare_rate = data["medicare"]["rate"]
    TABLES.additional_medicare_rate = data["medicare"]["additional_rate"]

    # Additional Medicare thresholds
    for (key, val) in data["medicare"]["additional_thresholds"]
        fs = FILING_STATUS_KEYS[key]
        TABLES.additional_medicare_thresholds[fs] = Float64(val)
    end

    # Standard deductions
    for (key, val) in data["standard_deduction"]
        fs = FILING_STATUS_KEYS[key]
        TABLES.standard_deductions[fs] = Float64(val)
    end

    # Income tax brackets
    for (key, brackets_arr) in data["income_tax_brackets"]
        fs = FILING_STATUS_KEYS[key]
        brackets = Bracket[]
        for b in brackets_arr
            max_val = isnothing(b["max"]) ? Inf : Float64(b["max"])
            push!(brackets, Bracket(b["rate"], Float64(b["min"]), max_val))
        end
        TABLES.brackets[fs] = brackets
    end

    # Pay periods per year
    for (key, val) in data["pay_periods_per_year"]
        pp = PAY_PERIOD_KEYS[key]
        TABLES.periods_per_year[pp] = val
    end

    TABLES.loaded = true
    @info "Tax tables loaded for TY$(TABLES.tax_year)"
    return nothing
end

# ---------------------------------------------------------------------------
# Core computation
# ---------------------------------------------------------------------------

"""
    compute_marginal_tax(taxable_income::Float64, brackets::Vector{Bracket}) -> (tax, marginal_rate)

Compute marginal federal income tax using the bracket schedule.
Returns the total tax and the marginal bracket rate.
"""
function compute_marginal_tax(taxable_income::Float64, brackets::Vector{Bracket})
    if taxable_income <= 0.0
        return (0.0, brackets[1].rate)
    end

    tax = 0.0
    marginal_rate = brackets[1].rate

    for b in brackets
        if taxable_income > b.min
            income_in_bracket = min(taxable_income, b.max) - b.min
            tax += income_in_bracket * b.rate
            marginal_rate = b.rate
        else
            break
        end
    end

    return (tax, marginal_rate)
end

"""
    compute_payroll_tax(input::TaxInput) -> TaxResult

Main entry point. Computes all federal payroll taxes for a single pay period
using the IRS annualization method.

The engine:
  1. Annualizes the per-period gross to project the yearly income
  2. Applies the standard deduction for the filing status
  3. Computes marginal federal income tax on the projected taxable income
  4. De-annualizes the tax back to per-period
  5. Computes Social Security tax (respecting the YTD wage base cap)
  6. Computes Medicare tax (regular + additional above threshold)
"""
function compute_payroll_tax(input::TaxInput)::TaxResult
    @assert TABLES.loaded "Tax tables not loaded. Call load_tax_tables!() first."

    gross = input.gross_per_period
    fs = input.filing_status
    pp = input.pay_period
    periods = TABLES.periods_per_year[pp]

    # --- Step 1: Annualize ---
    projected_annual = gross * periods

    # --- Step 2: Standard deduction ---
    std_ded = TABLES.standard_deductions[fs]
    projected_taxable = max(0.0, projected_annual - std_ded)

    # --- Step 3: Marginal federal income tax (annual) ---
    brackets = TABLES.brackets[fs]
    (annual_fed_tax, marginal_rate) = compute_marginal_tax(projected_taxable, brackets)

    # --- Step 4: De-annualize to per-period ---
    fed_tax_per_period = round(annual_fed_tax / periods; digits=2)

    # --- Step 5: Social Security (per-period, respecting YTD cap) ---
    # How much of THIS period's gross is subject to SS?
    ytd_after = input.ytd_gross + gross
    ss_remaining_cap = max(0.0, TABLES.ss_wage_base - input.ytd_gross)
    ss_taxable_this_period = min(gross, ss_remaining_cap)
    ss_tax = round(ss_taxable_this_period * TABLES.ss_rate; digits=2)

    # --- Step 6: Medicare (per-period) ---
    med_tax = round(gross * TABLES.medicare_rate; digits=2)

    # Additional Medicare: based on projected annual vs threshold
    add_med_threshold = TABLES.additional_medicare_thresholds[fs]
    add_med_tax = 0.0
    if projected_annual > add_med_threshold
        # Only the portion above the threshold, de-annualized
        annual_add_med = (projected_annual - add_med_threshold) * TABLES.additional_medicare_rate
        add_med_tax = round(annual_add_med / periods; digits=2)
    end

    # --- Totals ---
    total_fica = ss_tax + med_tax + add_med_tax
    total_tax = fed_tax_per_period + total_fica
    net_pay = round(gross - total_tax; digits=2)

    # Effective rates
    eff_fed = gross > 0 ? fed_tax_per_period / gross : 0.0
    eff_total = gross > 0 ? total_tax / gross : 0.0

    return TaxResult(
        gross, fs, pp,
        projected_annual, std_ded, projected_taxable,
        fed_tax_per_period, ss_tax, med_tax, add_med_tax,
        total_fica, total_tax, net_pay,
        round(eff_fed; digits=4), round(eff_total; digits=4),
        marginal_rate,
    )
end

# ---------------------------------------------------------------------------
# Pretty print
# ---------------------------------------------------------------------------

function Base.show(io::IO, r::TaxResult)
    println(io, "\n", "="^55)
    println(io, "  PNW Payroll Tax Computation — TY$(TABLES.tax_year)")
    println(io, "="^55)
    println(io, "  Filing: $(r.filing_status)  |  Period: $(r.pay_period)")
    println(io, "")
    println(io, "  Gross (this period):    \$$(round(r.gross_per_period; digits=2))")
    println(io, "  Projected annual:       \$$(round(r.projected_annual_gross; digits=2))")
    println(io, "  Standard deduction:    -\$$(round(r.standard_deduction; digits=2))")
    println(io, "  Projected taxable:      \$$(round(r.projected_taxable_income; digits=2))")
    println(io, "  Marginal bracket:       $(Int(r.marginal_bracket_rate * 100))%")
    println(io, "")
    println(io, "  Federal income tax:    -\$$(r.federal_income_tax)")
    println(io, "  Social Security:       -\$$(r.social_security_tax)")
    println(io, "  Medicare:              -\$$(r.medicare_tax)")
    if r.additional_medicare_tax > 0
        println(io, "  Additional Medicare:   -\$$(r.additional_medicare_tax)")
    end
    println(io, "  ─────────────────────────────")
    println(io, "  Total tax:             -\$$(r.total_tax)")
    println(io, "  Net pay:                \$$(r.net_pay)")
    println(io, "")
    println(io, "  Effective federal rate:  $(round(r.effective_federal_rate * 100; digits=1))%")
    println(io, "  Effective total rate:    $(round(r.effective_total_rate * 100; digits=1))%")
    println(io, "="^55)
end

end # module TaxEngine
