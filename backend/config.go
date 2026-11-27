package main

import (
	"errors"
	"net/netip"
	"net/url"
	"os"
	"strings"
)

func secretEnv(name string) string {
	if file := os.Getenv(name + "_FILE"); file != "" {
		raw, e := os.ReadFile(file)
		if e != nil {
			return ""
		}
		return strings.TrimSpace(string(raw))
	}
	return os.Getenv(name)
}
func databaseURL() string {
	if value := secretEnv("DATABASE_URL"); value != "" {
		return value
	}
	if os.Getenv("PGHOST") == "" {
		return ""
	}
	u := url.URL{Scheme: "postgres", Host: env("PGHOST", "db") + ":" + env("PGPORT", "5432"), Path: "/" + env("PGDATABASE", "mkdocsweb"), User: url.UserPassword(env("PGUSER", "mkdocsweb"), secretEnv("PGPASSWORD"))}
	q := u.Query()
	q.Set("sslmode", env("PGSSLMODE", "disable"))
	u.RawQuery = q.Encode()
	return u.String()
}
func transportConfig(origin, allow, proxy string) (Config, error) {
	u, e := url.Parse(origin)
	cfg := Config{Origin: origin, StaticDir: env("STATIC_DIR", "dist"), AllowHTTP: allow == "true"}
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || (u.Scheme != "https" && u.Scheme != "http") {
		return cfg, errors.New("APP_ORIGIN must be an http(s) origin without a trailing slash")
	}
	if u.Scheme == "http" && !cfg.AllowHTTP {
		return cfg, errors.New("HTTP requires explicit ALLOW_HTTP=true")
	}
	if u.Scheme == "https" && cfg.AllowHTTP {
		return cfg, errors.New("set ALLOW_HTTP=false when APP_ORIGIN uses HTTPS")
	}
	if proxy != "" {
		cfg.TrustedProxy, e = netip.ParsePrefix(proxy)
		if e != nil || cfg.TrustedProxy.Bits() == 0 {
			return cfg, errors.New("invalid TRUSTED_PROXY_CIDR")
		}
	}
	return cfg, nil
}
