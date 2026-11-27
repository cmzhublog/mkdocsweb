package main

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"golang.org/x/term"
	"log"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func env(key, fallback string) string {
	if s := os.Getenv(key); s != "" {
		return s
	}
	return fallback
}
func main() {
	if len(os.Args) > 1 && os.Args[1] == "keygen" {
		b := make([]byte, 32)
		if _, e := rand.Read(b); e != nil {
			log.Fatal(e)
		}
		fmt.Println(base64.StdEncoding.EncodeToString(b))
		return
	}
	key, e := base64.StdEncoding.DecodeString(os.Getenv("MASTER_KEY"))
	if e != nil || len(key) != 32 {
		log.Fatal("Set MASTER_KEY to a base64-encoded random 32-byte key (run: mkdocsweb keygen)")
	}
	s, e := openStore(env("DATA_FILE", "data/mkdocsweb.db"), key)
	if e != nil {
		log.Fatal(e)
	}
	defer s.db.Close()
	if len(os.Args) > 1 && os.Args[1] == "create-admin" {
		if len(os.Args) != 3 {
			log.Fatal("Usage: mkdocsweb create-admin username (password read privately from terminal)")
		}
		fmt.Fprint(os.Stderr, "Password (12–128 bytes): ")
		password, e := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		if e != nil {
			log.Fatal("A terminal is required for password input")
		}
		if _, e = s.createUser(os.Args[2], string(password), "admin"); e != nil {
			log.Fatal(e)
		}
		fmt.Println("Administrator created")
		return
	}
	origin := os.Getenv("APP_ORIGIN")
	u, e := url.Parse(origin)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" {
		log.Fatal("APP_ORIGIN must be an HTTPS origin without trailing slash, e.g. https://notes.example.com")
	}
	cfg := Config{Origin: origin, StaticDir: env("STATIC_DIR", "dist")}
	if proxy := os.Getenv("TRUSTED_PROXY_CIDR"); proxy != "" {
		cfg.TrustedProxy, e = netip.ParsePrefix(proxy)
		if e != nil || cfg.TrustedProxy.Bits() == 0 {
			log.Fatal("Invalid trusted proxy CIDR")
		}
	}
	cert, keyFile := os.Getenv("TLS_CERT_FILE"), os.Getenv("TLS_KEY_FILE")
	if (cert == "") != (keyFile == "") {
		log.Fatal("Both TLS_CERT_FILE and TLS_KEY_FILE are required")
	}
	addr := env("LISTEN_ADDR", "127.0.0.1:8080")
	if cert == "" {
		if !cfg.TrustedProxy.IsValid() {
			log.Fatal("TLS certificates or explicit TRUSTED_PROXY_CIDR required")
		}
		if !strings.HasPrefix(addr, "127.0.0.1:") && !strings.HasPrefix(addr, "[::1]:") {
			log.Fatal("Proxy mode must bind to loopback; run HTTPS proxy on same host/network namespace")
		}
	}
	server := &http.Server{Addr: addr, Handler: newApp(s, cfg), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 90 * time.Second, WriteTimeout: 90 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		server.Shutdown(shutdown)
	}()
	log.Printf("MkDocs Web listening on %s", addr)
	if cert != "" {
		e = server.ListenAndServeTLS(cert, keyFile)
	} else {
		e = server.ListenAndServe()
	}
	if e != nil && e != http.ErrServerClosed {
		log.Fatal(e)
	}
}
