FROM julia:1.11-bookworm

WORKDIR /app

# Copy project files first for layer caching
COPY Project.toml .
RUN julia --project=. -e 'using Pkg; Pkg.instantiate(); Pkg.precompile()'

# Copy source + tax tables
COPY src/ src/
COPY tax_tables/ tax_tables/

ENV PNW_TAX_ENGINE_PORT=8787
EXPOSE 8787

CMD ["julia", "--project=.", "src/server.jl"]
