# Caddy with the DuckDNS DNS module, to get a trusted HTTPS certificate via the
# DNS-01 challenge: Let's Encrypt only checks a TXT record at DuckDNS and never
# connects to this server, so no port has to be opened on the router.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/duckdns

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
