package main

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"golang.org/x/term"
	"log"
	"net"
	"net/http"

	"os"
	"os/signal"

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
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		_, port, e := net.SplitHostPort(env("LISTEN_ADDR", "0.0.0.0:8080"))
		if e != nil {
			os.Exit(1)
		}
		conn, e := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", port), 3*time.Second)
		if e != nil {
			os.Exit(1)
		}
		conn.Close()
		return
	}

	if len(os.Args) > 1 && os.Args[1] == "keygen" {
		b := make([]byte, 32)
		if _, e := rand.Read(b); e != nil {
			log.Fatal(e)
		}
		fmt.Println(base64.StdEncoding.EncodeToString(b))
		return
	}
	key, e := base64.StdEncoding.DecodeString(secretEnv("MASTER_KEY"))
	if e != nil || len(key) != 32 {
		log.Fatal("Set MASTER_KEY to a base64-encoded random 32-byte key (run: mkdocsweb keygen)")
	}
	var s *Store
	if dsn := databaseURL(); dsn != "" {
		var db recordDB
		db, e = openPostgres(dsn)
		if e == nil {
			s, e = initializeStore(db, key)
		}
	} else {
		s, e = openStore(env("DATA_FILE", "data/mkdocsweb.db"), key)
	}
	if e != nil {
		log.Fatal(e)
	}
	defer s.db.Close()
	if len(os.Args) > 1 && os.Args[1] == "bootstrap-admin" {
		username := env("ADMIN_USERNAME", "admin")
		password := secretEnv("ADMIN_PASSWORD")
		if e := s.bootstrapAdmin(username, password); e != nil {
			log.Fatal(e)
		}
		fmt.Println("Administrator bootstrap complete (existing users left unchanged)")
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "migrate-bbolt" {
		path := os.Getenv("LEGACY_DATA_FILE")
		if path == "" || databaseURL() == "" {
			log.Fatal("Set LEGACY_DATA_FILE and PostgreSQL connection settings")
		}
		if e := s.migrateBbolt(path, key); e != nil {
			log.Fatal(e)
		}
		fmt.Println("Encrypted bbolt records migrated to PostgreSQL")
		return
	}
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
	cfg, e := transportConfig(os.Getenv("APP_ORIGIN"), os.Getenv("ALLOW_HTTP"), os.Getenv("TRUSTED_PROXY_CIDR"))
	if e != nil {
		log.Fatal(e)
	}
	cert, keyFile := os.Getenv("TLS_CERT_FILE"), os.Getenv("TLS_KEY_FILE")
	if (cert == "") != (keyFile == "") {
		log.Fatal("Both TLS_CERT_FILE and TLS_KEY_FILE are required")
	}
	if !cfg.AllowHTTP && cert == "" && !cfg.TrustedProxy.IsValid() {
		log.Fatal("HTTPS requires TLS certificates or TRUSTED_PROXY_CIDR")
	}
	addr := env("LISTEN_ADDR", "127.0.0.1:8080")
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
