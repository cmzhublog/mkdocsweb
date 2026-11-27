package main

import (
	"bytes"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"net/url"

	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testPassword = "test-password-long-123"

type testSession struct {
	cookie *http.Cookie
	csrf   string
	user   User
}

func setup(t *testing.T) (*App, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "app.db")
	dsn := os.Getenv("TEST_DATABASE_URL")
	if os.Getenv("TEST_POSTGRES") == "true" {
		dsn = databaseURL()
	}
	if dsn != "" {
		admin, e := sql.Open("pgx", dsn)
		if e != nil {
			t.Fatal(e)
		}
		schema := "mkdocs_test_" + randomID()[:16]
		if _, e = admin.Exec("CREATE SCHEMA " + schema); e != nil {
			admin.Close()
			t.Fatal(e)
		}
		t.Cleanup(func() { admin.Exec("DROP SCHEMA " + schema + " CASCADE"); admin.Close() })
		u, e := url.Parse(dsn)
		if e != nil {
			t.Fatal(e)
		}
		q := u.Query()
		q.Set("search_path", schema)
		u.RawQuery = q.Encode()
		path = u.String()
	}
	s, e := openTestStore(path, bytes.Repeat([]byte{7}, 32))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.db.Close() })
	return newApp(s, Config{Origin: "https://app.test", StaticDir: t.TempDir()}), path
}
func request(t *testing.T, a *App, s *testSession, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	r := httptest.NewRequest(method, "https://app.test"+path, bytes.NewReader(raw))
	r.Header.Set("Origin", "https://app.test")
	r.Header.Set("Content-Type", "application/json")
	if s != nil {
		r.AddCookie(s.cookie)
		r.Header.Set("X-Session-User", s.user.ID)
		r.Header.Set("X-CSRF-Token", s.csrf)
	}
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	return w
}
func loginTest(t *testing.T, a *App, name, role string) testSession {
	t.Helper()
	if _, e := a.store.createUser(name, testPassword, role); e != nil {
		t.Fatal(e)
	}
	w := request(t, a, nil, "POST", "/api/auth/login", map[string]string{"username": name, "password": testPassword})
	if w.Code != 200 {
		t.Fatalf("login: %d %s", w.Code, w.Body)
	}
	var value struct {
		User User   `json:"user"`
		CSRF string `json:"csrf"`
	}
	json.Unmarshal(w.Body.Bytes(), &value)
	return testSession{w.Result().Cookies()[0], value.CSRF, value.User}
}
func expectStatus(t *testing.T, w *httptest.ResponseRecorder, status int) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("expected %d, got %d: %s", status, w.Code, w.Body)
	}
}
func workspaceBody(rev int, content string) map[string]any {
	return map[string]any{"revision": rev, "workspace": map[string]any{"notes": []any{map[string]any{"id": "note", "title": "title", "content": content, "updatedAt": 1}}, "folders": []any{}, "activeId": "note"}}
}

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestSecurityAndIsolation(t *testing.T) {
	a, path := setup(t)
	admin := loginTest(t, a, "administrator", "admin")
	alice := loginTest(t, a, "alice", "user")
	bob := loginTest(t, a, "bob", "user")
	t.Run("anonymous access and registration", func(t *testing.T) {
		for _, p := range []string{"/api/workspace", "/api/auth/session", "/api/admin/users"} {
			expectStatus(t, request(t, a, nil, "GET", p, nil), 401)
		}
		expectStatus(t, request(t, a, &alice, "POST", "/api/register", map[string]string{}), 404)
		expectStatus(t, request(t, a, &alice, "GET", "/api/admin/users", nil), 403)
	})
	t.Run("cookie and csrf", func(t *testing.T) {
		c := alice.cookie
		if !c.Secure || !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.Path != "/" || c.Domain != "" {
			t.Fatal("unsafe cookie")
		}
		bad := alice
		bad.csrf = "invalid"
		expectStatus(t, request(t, a, &bad, "PUT", "/api/workspace", workspaceBody(0, "secret")), 403)
		r := httptest.NewRequest("POST", "https://app.test/api/auth/logout", nil)
		r.AddCookie(alice.cookie)
		r.Header.Set("Origin", "https://evil.test")
		r.Header.Set("X-CSRF-Token", alice.csrf)
		w := httptest.NewRecorder()
		a.ServeHTTP(w, r)
		expectStatus(t, w, 403)
	})
	t.Run("account switching cannot mix documents", func(t *testing.T) {
		bad := alice
		bad.cookie = bob.cookie
		expectStatus(t, request(t, a, &bad, "PUT", "/api/workspace", workspaceBody(0, "alice-secret")), 401)
	})
	t.Run("workspace isolation and conflict", func(t *testing.T) {
		expectStatus(t, request(t, a, &alice, "PUT", "/api/workspace", workspaceBody(0, "private-alice-marker")), 200)
		expectStatus(t, request(t, a, &alice, "PUT", "/api/workspace", workspaceBody(0, "stale")), 409)
		for _, s := range []*testSession{&bob, &admin} {
			w := request(t, a, s, "GET", "/api/workspace?userId="+alice.user.ID, nil)
			expectStatus(t, w, 200)
			if strings.Contains(w.Body.String(), "private-alice-marker") {
				t.Fatal("workspace leaked")
			}
		}
		expectStatus(t, request(t, a, &bob, "PUT", "/api/workspace", workspaceBody(0, "private-bob-marker")), 200)
	})
	t.Run("encrypted isolated Git credentials", func(t *testing.T) {
		tokens := []string{}
		a.client.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
			if r.URL.Host != "api.github.com" {
				t.Fatal("SSRF")
			}
			tokens = append(tokens, r.Header.Get("Authorization"))
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"default_branch":"main"}`))}, nil
		})
		expectStatus(t, request(t, a, &alice, "POST", "/api/git/request", map[string]any{"path": "/repos/secretowner/secretrepo", "method": "GET", "token": "ghp-private-token-marker"}), 200)
		w := request(t, a, &alice, "POST", "/api/git/request", map[string]any{"path": "/repos/secretowner/secretrepo", "method": "GET"})
		expectStatus(t, w, 200)
		if strings.Contains(w.Body.String(), "ghp-private") {
			t.Fatal("token returned")
		}
		expectStatus(t, request(t, a, &bob, "POST", "/api/git/request", map[string]any{"path": "/repos/secretowner/secretrepo", "method": "GET"}), 200)
		if len(tokens) != 3 || tokens[0] != "Bearer ghp-private-token-marker" || tokens[1] != tokens[0] || tokens[2] != "" {
			t.Fatal("credential isolation failed")
		}
		raw, e := encryptedTestDump(a.store, path)
		if e != nil {
			t.Fatal(e)
		}
		for _, secret := range []string{"private-alice-marker", "private-bob-marker", "ghp-private-token-marker", "secretowner", "secretrepo", alice.cookie.Value, testPassword, "administrator"} {
			if bytes.Contains(raw, []byte(secret)) {
				t.Fatalf("plaintext persisted: %s", secret)
			}
		}
		expectStatus(t, request(t, a, &alice, "DELETE", "/api/git/credential", map[string]string{"repository": "secretowner/secretrepo"}), 200)
	})
	t.Run("ssrf and force push", func(t *testing.T) {
		for _, path := range []string{"https://evil.test/", "//evil.test/repos/x/y", "/repos/x/y/../../user", "/repos/x/y/issues", "/repos/x/y?redirect=evil", "/repos/x/y/git/ref/heads/main?x=1"} {
			expectStatus(t, request(t, a, &alice, "POST", "/api/git/request", map[string]any{"path": path, "method": "GET"}), 400)
		}
		expectStatus(t, request(t, a, &alice, "POST", "/api/git/request", map[string]any{"path": "/repos/x/y/git/refs/heads/main", "method": "PATCH", "body": map[string]any{"sha": strings.Repeat("a", 40), "force": true}}), 400)
	})
	t.Run("admin and session revocation", func(t *testing.T) {
		expectStatus(t, request(t, a, &admin, "PATCH", "/api/admin/users/"+admin.user.ID, map[string]any{"disabled": true}), 400)
		expectStatus(t, request(t, a, &admin, "POST", "/api/admin/users", map[string]string{"username": "new-user", "password": testPassword, "role": "user"}), 201)
		expectStatus(t, request(t, a, &admin, "PATCH", "/api/admin/users/"+bob.user.ID, map[string]any{"disabled": true}), 200)
		expectStatus(t, request(t, a, &bob, "GET", "/api/workspace", nil), 401)
		expectStatus(t, request(t, a, &admin, "PATCH", "/api/admin/users/"+alice.user.ID, map[string]any{"password": "new-password-long-123"}), 200)
		expectStatus(t, request(t, a, &alice, "GET", "/api/workspace", nil), 401)
	})
}
func TestTransportAndExpiry(t *testing.T) {
	a, _ := setup(t)
	s := loginTest(t, a, "alice", "user")
	for _, tc := range []struct {
		remote, proxy string
		trusted       bool
		want          int
	}{{"127.0.0.1:1234", "https", false, 426}, {"127.0.0.1:1234", "http", true, 426}, {"192.0.2.1:1234", "https", true, 426}, {"127.0.0.1:1234", "https", true, 200}} {
		a.cfg.TrustedProxy = netip.Prefix{}
		if tc.trusted {
			a.cfg.TrustedProxy = netip.MustParsePrefix("127.0.0.1/32")
		}
		r := httptest.NewRequest("GET", "http://app.test/api/auth/session", nil)
		r.RemoteAddr = tc.remote
		r.TLS = nil
		r.Header.Set("X-Forwarded-Proto", tc.proxy)
		r.AddCookie(s.cookie)
		w := httptest.NewRecorder()
		a.ServeHTTP(w, r)
		expectStatus(t, w, tc.want)
	}
	if e := a.store.db.Update(func(tx *recordTx) error {
		var v Session
		if e := a.store.get(tx, "sessions", sessionKey(s.cookie.Value), &v); e != nil {
			return e
		}
		v.LastSeen = time.Now().Add(-31 * time.Minute).Unix()
		return a.store.put(tx, "sessions", sessionKey(s.cookie.Value), v)
	}); e != nil {
		t.Fatal(e)
	}
	expectStatus(t, request(t, a, &s, "GET", "/api/workspace", nil), 401)
	srv := httptest.NewTLSServer(a)
	defer srv.Close()
	a.cfg.Origin = srv.URL
	resp, e := srv.Client().Get(srv.URL + "/api/workspace")
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 401 || resp.TLS.Version < tls.VersionTLS12 {
		t.Fatal("TLS authentication failed")
	}
}
func TestEncryptionTamperAndWrongKey(t *testing.T) {
	a, path := setup(t)
	s := loginTest(t, a, "alice", "user")
	expectStatus(t, request(t, a, &s, "PUT", "/api/workspace", workspaceBody(0, "secret")), 200)
	if e := a.store.db.Update(func(tx *recordTx) error {
		raw, e := tx.Get("workspaces", s.user.ID)
		if e != nil {
			return e
		}
		raw[len(raw)-1] ^= 1
		return tx.Put("workspaces", s.user.ID, raw)
	}); e != nil {
		t.Fatal(e)
	}
	expectStatus(t, request(t, a, &s, "GET", "/api/workspace", nil), 500)
	a.store.db.Close()
	if other, e := openTestStore(path, bytes.Repeat([]byte{8}, 32)); e == nil {
		other.db.Close()
		t.Fatal("wrong key accepted")
	}
}
func TestPasswordLogoutRateLimit(t *testing.T) {
	a, _ := setup(t)
	s := loginTest(t, a, "alice", "user")
	expectStatus(t, request(t, a, &s, "POST", "/api/auth/password", map[string]string{"currentPassword": "wrong", "password": "new-password-long-123"}), 403)
	expectStatus(t, request(t, a, &s, "POST", "/api/auth/password", map[string]string{"currentPassword": testPassword, "password": "new-password-long-123"}), 200)
	expectStatus(t, request(t, a, &s, "GET", "/api/auth/session", nil), 401)
	for i := 0; i < 9; i++ {
		request(t, a, nil, "POST", "/api/auth/login", map[string]string{"username": "missing", "password": "wrong"})
	}
	expectStatus(t, request(t, a, nil, "POST", "/api/auth/login", map[string]string{"username": "missing", "password": "wrong"}), 429)
}

func TestLogoutAndWorkspaceValidation(t *testing.T) {
	a, _ := setup(t)
	s := loginTest(t, a, "alice", "user")
	expectStatus(t, request(t, a, &s, "PUT", "/api/workspace", workspaceBody(0, "preserved")), 200)
	malformed := workspaceBody(1, "bad")
	malformed["workspace"].(map[string]any)["folders"] = []any{map[string]any{"id": "cycle", "name": "cycle", "parentId": "cycle", "collapsed": false}}
	expectStatus(t, request(t, a, &s, "PUT", "/api/workspace", malformed), 400)
	w := request(t, a, &s, "GET", "/api/workspace", nil)
	if !strings.Contains(w.Body.String(), "preserved") {
		t.Fatal("invalid save replaced workspace")
	}
	expectStatus(t, request(t, a, &s, "POST", "/api/auth/logout", nil), 200)
	expectStatus(t, request(t, a, &s, "GET", "/api/auth/session", nil), 401)
}

func TestRevokesAllSessionsWithoutSkippingAdjacentRecords(t *testing.T) {
	a, _ := setup(t)
	alice := loginTest(t, a, "alice", "user")
	bob := loginTest(t, a, "bob", "user")
	if e := a.store.db.Update(func(tx *recordTx) error {
		for _, key := range []string{"a", "b", "c", "d", "e"} {
			if e := a.store.put(tx, "sessions", key, Session{UserID: alice.user.ID, Expires: time.Now().Add(time.Hour).Unix(), LastSeen: time.Now().Unix()}); e != nil {
				return e
			}
		}
		return a.store.revoke(tx, alice.user.ID)
	}); e != nil {
		t.Fatal(e)
	}
	if e := a.store.db.View(func(tx *recordTx) error {
		return tx.ForEach("sessions", func(k, _ []byte) error {
			var s Session
			if e := a.store.get(tx, "sessions", string(k), &s); e != nil {
				return e
			}
			if s.UserID == alice.user.ID {
				t.Fatal("revoked session remains")
			}
			return nil
		})
	}); e != nil {
		t.Fatal(e)
	}
	expectStatus(t, request(t, a, &alice, "GET", "/api/auth/session", nil), 401)
	expectStatus(t, request(t, a, &bob, "GET", "/api/auth/session", nil), 200)
}

func openTestStore(path string, key []byte) (*Store, error) {
	if strings.HasPrefix(path, "postgres") {
		db, e := openPostgres(path)
		if e != nil {
			return nil, e
		}
		return initializeStore(db, key)
	}
	return openStore(path, key)
}
func encryptedTestDump(s *Store, path string) ([]byte, error) {
	if !strings.HasPrefix(path, "postgres") {
		return os.ReadFile(path)
	}
	var raw []byte
	e := s.db.View(func(tx *recordTx) error {
		for _, b := range []string{"users", "sessions", "workspaces", "credentials", "meta"} {
			if e := tx.ForEach(b, func(k, v []byte) error { raw = append(raw, k...); raw = append(raw, v...); return nil }); e != nil {
				return e
			}
		}
		return nil
	})
	return raw, e
}
func TestHTTPModeRequiresExplicitConfiguration(t *testing.T) {
	if _, e := transportConfig("http://localhost:8080", "false", ""); e == nil {
		t.Fatal("implicit HTTP accepted")
	}
	if _, e := transportConfig("https://app.test", "true", ""); e == nil {
		t.Fatal("HTTP downgrade of HTTPS origin accepted")
	}
	a, _ := setup(t)
	cfg, e := transportConfig("http://localhost:8080", "true", "")
	if e != nil {
		t.Fatal(e)
	}
	a.cfg = cfg
	if _, e := a.store.createUser("alice", testPassword, "user"); e != nil {
		t.Fatal(e)
	}
	body := strings.NewReader(`{"username":"alice","password":"` + testPassword + `"}`)
	r := httptest.NewRequest("POST", "http://localhost:8080/api/auth/login", body)
	r.Header.Set("Origin", a.cfg.Origin)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	expectStatus(t, w, 200)
	c := w.Result().Cookies()[0]
	if c.Secure || c.Name != "mkdocs-session" || !c.HttpOnly || c.SameSite != http.SameSiteStrictMode {
		t.Fatal("incorrect HTTP cookie")
	}
	if w.Header().Get("Strict-Transport-Security") != "" {
		t.Fatal("HSTS on HTTP")
	}
	var auth struct {
		User User   `json:"user"`
		CSRF string `json:"csrf"`
	}
	json.Unmarshal(w.Body.Bytes(), &auth)
	r = httptest.NewRequest("GET", "http://localhost:8080/api/workspace", nil)
	r.AddCookie(c)
	r.Header.Set("X-Session-User", auth.User.ID)
	w = httptest.NewRecorder()
	a.ServeHTTP(w, r)
	expectStatus(t, w, 200)
	r = httptest.NewRequest("PUT", "http://localhost:8080/api/workspace", strings.NewReader(`{}`))
	r.AddCookie(c)
	r.Header.Set("Origin", a.cfg.Origin)
	r.Header.Set("X-Session-User", auth.User.ID)
	r.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	a.ServeHTTP(w, r)
	expectStatus(t, w, 403)
}
func TestBootstrapIsIdempotent(t *testing.T) {
	a, _ := setup(t)
	if e := a.store.bootstrapAdmin("admin", testPassword); e != nil {
		t.Fatal(e)
	}
	if e := a.store.bootstrapAdmin("another-admin", "changed-password-123"); e != nil {
		t.Fatal(e)
	}
	a.store.db.View(func(tx *recordTx) error {
		users, e := a.store.users(tx)
		if len(users) != 1 || users[0].Username != "admin" || !verifyPassword(users[0], testPassword) {
			t.Fatal("bootstrap changed existing accounts")
		}
		return e
	})
}

func TestMigrationPreservesEncryptedRecordsAndRefusesOverwrite(t *testing.T) {
	a, _ := setup(t)
	key := bytes.Repeat([]byte{7}, 32)
	path := filepath.Join(t.TempDir(), "legacy.db")
	old, e := openStore(path, key)
	if e != nil {
		t.Fatal(e)
	}
	user, e := old.createUser("legacy-user", testPassword, "admin")
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(workspaceBody(0, "legacy-private-document")["workspace"])
	if e = old.db.Update(func(tx *recordTx) error {
		return old.put(tx, "workspaces", user.ID, Document{Revision: 9, Workspace: raw})
	}); e != nil {
		t.Fatal(e)
	}
	old.db.Close()
	if e = a.store.migrateBbolt(path, key); e != nil {
		t.Fatal(e)
	}
	if e = a.store.db.View(func(tx *recordTx) error {
		var u User
		if e := a.store.get(tx, "users", user.ID, &u); e != nil {
			return e
		}
		if !verifyPassword(u, testPassword) {
			t.Fatal("password lost in migration")
		}
		var d Document
		if e := a.store.get(tx, "workspaces", user.ID, &d); e != nil {
			return e
		}
		if d.Revision != 9 || !strings.Contains(string(d.Workspace), "legacy-private-document") {
			t.Fatal("document lost")
		}
		return nil
	}); e != nil {
		t.Fatal(e)
	}
	if e = a.store.migrateBbolt(path, key); e == nil {
		t.Fatal("migration overwrote existing records")
	}
}
