"""
    PNW Payroll Engine — HTTP API Server

Exposes the TaxEngine as a lightweight JSON API for the portal
to call via its Next.js API routes.

Single endpoint:
  POST /compute
  Body: { gross, filing_status, pay_period, ytd_gross?, ytd_ss_tax? }
  Response: full TaxResult as JSON

Start: julia --project=. src/server.jl
"""

include("TaxEngine.jl")
using .TaxEngine
using HTTP
using JSON

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

const PORT = parse(Int, get(ENV, "PNW_TAX_ENGINE_PORT", "8787"))
const TAX_TABLES_PATH = joinpath(@__DIR__, "..", "tax_tables", "federal_2026.json")

# ---------------------------------------------------------------------------
# Filing status + pay period string → enum mapping
# ---------------------------------------------------------------------------

const FS_MAP = Dict(
    "single" => SINGLE,
    "married_filing_jointly" => MARRIED_FILING_JOINTLY,
    "married_filing_separately" => MARRIED_FILING_SEPARATELY,
    "head_of_household" => HEAD_OF_HOUSEHOLD,
)

const PP_MAP = Dict(
    "daily" => DAILY,
    "weekly" => WEEKLY,
    "biweekly" => BIWEEKLY,
    "semimonthly" => SEMIMONTHLY,
    "monthly" => MONTHLY,
    "quarterly" => QUARTERLY,
)

# ---------------------------------------------------------------------------
# Request handler
# ---------------------------------------------------------------------------

function handle_compute(req::HTTP.Request)
    try
        body = JSON.parse(String(req.body))

        gross = Float64(body["gross"])
        fs_str = lowercase(get(body, "filing_status", "single"))
        pp_str = lowercase(get(body, "pay_period", "biweekly"))
        ytd_gross = Float64(get(body, "ytd_gross", 0.0))
        ytd_ss = Float64(get(body, "ytd_ss_tax", 0.0))

        fs = get(FS_MAP, fs_str, SINGLE)
        pp = get(PP_MAP, pp_str, BIWEEKLY)

        input = TaxInput(gross, fs, pp, ytd_gross, ytd_ss)
        result = compute_payroll_tax(input)

        response = Dict(
            "gross_per_period" => result.gross_per_period,
            "filing_status" => string(result.filing_status),
            "pay_period" => string(result.pay_period),
            "projected_annual_gross" => result.projected_annual_gross,
            "standard_deduction" => result.standard_deduction,
            "projected_taxable_income" => result.projected_taxable_income,
            "federal_income_tax" => result.federal_income_tax,
            "social_security_tax" => result.social_security_tax,
            "medicare_tax" => result.medicare_tax,
            "additional_medicare_tax" => result.additional_medicare_tax,
            "total_fica" => result.total_fica,
            "total_tax" => result.total_tax,
            "net_pay" => result.net_pay,
            "effective_federal_rate" => result.effective_federal_rate,
            "effective_total_rate" => result.effective_total_rate,
            "marginal_bracket_rate" => result.marginal_bracket_rate,
            "tax_year" => TaxEngine.TABLES.tax_year,
        )

        return HTTP.Response(200,
            ["Content-Type" => "application/json",
             "Access-Control-Allow-Origin" => "*"],
            JSON.json(response),
        )
    catch e
        @warn "Compute error" exception=(e, catch_backtrace())
        return HTTP.Response(400,
            ["Content-Type" => "application/json"],
            JSON.json(Dict("error" => string(e))),
        )
    end
end

function handle_health(::HTTP.Request)
    return HTTP.Response(200,
        ["Content-Type" => "application/json"],
        JSON.json(Dict(
            "status" => "ok",
            "tax_year" => TaxEngine.TABLES.tax_year,
            "loaded" => TaxEngine.TABLES.loaded,
        )),
    )
end

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

function router(req::HTTP.Request)
    path = HTTP.URI(req.target).path

    # CORS preflight
    if req.method == "OPTIONS"
        return HTTP.Response(204, [
            "Access-Control-Allow-Origin" => "*",
            "Access-Control-Allow-Methods" => "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers" => "Content-Type",
        ])
    end

    if path == "/compute" && req.method == "POST"
        return handle_compute(req)
    elseif path == "/health" && req.method == "GET"
        return handle_health(req)
    else
        return HTTP.Response(404, JSON.json(Dict("error" => "not found")))
    end
end

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

function main()
    @info "Loading tax tables from $TAX_TABLES_PATH"
    load_tax_tables!(TAX_TABLES_PATH)

    @info "PNW Payroll Tax Engine starting on port $PORT"
    @info "Endpoints: POST /compute, GET /health"
    HTTP.serve(router, "0.0.0.0", PORT)
end

main()
